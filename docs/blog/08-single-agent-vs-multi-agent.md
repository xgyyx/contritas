# 多 Agent 是糖，状态机是骨 —— 为什么 Contritas 不是\"多 Agent 协作\"架构

> 本系列前几篇：
> 1. [《我做了一个会跟你唱反调的 AI 尽调 Agent——聊聊 Contritas 的架构与选型》](./01-architecture-and-stack.md)
> 2. [《怎么让 LLM 跟你唱反调》](./02-anti-flattery-prompt-design.md)
> 3. [《Phase 4 交叉验证：让 LLM 找证据矛盾》](./03-phase4-cross-validation.md)
> 4. [《如果你能用 Claude Code，为什么还要 Contritas？》](./04-vs-general-agent.md)
> 5. [《搜索降级链与"接受部分缺失"的工程纪律》](./05-search-fallback-and-evidence-discipline.md)
> 6. [《报告自检（Phase 5 self-check）》](./06-phase5-self-check.md)
> 7. [《为什么 Contritas 不做"实时浏览/深思考演示"？》](./07-no-thinking-stream.md)

---

## 一、被问到最多的一个架构问题

最近一年但凡跟人聊 AI Agent 项目，逃不掉一个问题：

> "你这个是 multi-agent 架构吗？"

潜台词通常是：现在 LangGraph、AutoGen、CrewAI、Claude Agent SDK 都在卷 multi-agent，你不上一个 Researcher Agent + Critic Agent + Synthesizer Agent 的协作架构，是不是落伍了？

Contritas 的回答很简单：**不是，是单 Agent + 多 Phase 状态机流水线**。打开 [`packages/workflow/src/machine.ts`](../../packages/workflow/src/machine.ts)，编排层就是一台 XState v5 状态机，6 个 Phase 一条道串下来，每个 Phase 下面挂一个或多个 actor——这里说的 actor 是 XState 的概念（状态节点上执行的副作用函数），不是\"多智能体协作\"语境里的 agent。

写这篇不是为了证明\"我对你错\"。多 Agent 框架在某些场景下确实是更好的答案。这篇要说清楚的是：**为什么对\"尽职调查\"这件具体的事，我有意识地选择了状态机而不是多 Agent**——以及哪些假设变了，我会切到多 Agent。

---

## 二、先承认：多 Agent 协作真正在解决的问题

我不想用稻草人去打多 Agent。先把它真正的卖点摆出来，免得后面对比变成胡说八道。

多 Agent 框架（无论是 LangGraph 的 stateful graph、AutoGen 的 conversational agents、CrewAI 的 role-based crew，还是 Claude Agent SDK 的 sub-agent 模式）的核心承诺，本质上是三件事：

### 2.1 角色分工带来的 prompt 解耦

让一个 Researcher Agent 专心找信息，一个 Critic Agent 专心挑刺，一个 Synthesizer Agent 专心写结论——每个 agent 的 system prompt 短、聚焦、好维护。比起在一个 4000 字的巨型 prompt 里写\"你是一个既要找证据又要挑刺又要写报告的全能 AI\"，分工版可读性高得多。

### 2.2 多视角带来的盲点覆盖

让 Bull Agent 和 Bear Agent 同台辩论一个投资命题，比让一个 agent\"既扮正方又扮反方\"更可能跑出真正的对立视角。Critic Agent 没有\"我刚写完不想自我否定\"的偏见——它从一开始就被训练成\"看到任何结论都挑刺\"。

### 2.3 动态协作带来的探索性

多 Agent 之间可以协商：Researcher 说\"我搜不到\"，Critic 可以反问\"换个 query 试试\"，Synthesizer 可以说\"证据不够，回去多找两轮\"。这种交互在状态机里要预先画好所有分支，多 Agent 里 LLM 自己就把它演完了。

**这三件事都是真本事**，不是营销话术。任何工程师评估\"要不要上多 Agent\"，应该先问自己：上面这三个收益，我的场景能拿到几个？

---

## 三、尽调场景的四个硬约束，每一个都跟多 Agent 打架

回到 Contritas。下面这四件事是这个产品**必须**做到的（不是\"做到更好\"，是\"做不到就不叫尽调\"）。每一件单独看，多 Agent 都能凑合处理；四件叠加，状态机就成了更稳的答案。

### 3.1 长任务必须可恢复——多 Agent 的中间状态难序列化

一次完整尽调 10–60 分钟，涉及 80–150 次搜索、几十次 LLM 调用（见 [`01-architecture-and-stack.md:51`](./01-architecture-and-stack.md)）。这个时长意味着：Worker 可能被部署重启、Redis 可能短暂不可达、某个 LLM provider 可能限流——**任何一次中断都不能让用户的活儿白干**。

状态机的处理是\"在每个 Phase 边界 snapshot 一次到 DB\"。重启后从最后一个完成的 Phase 续做，这是 [`packages/workflow/src/machine.ts`](../../packages/workflow/src/machine.ts) 用 XState `getPersistedSnapshot` 干的事。

多 Agent 的中间状态长什么样？是 N 个 agent 之间的对话历史 + 每个 agent 自己的工作记忆 + 当前正在执行哪个 tool call。这些东西**理论上**也能序列化，但有几个坑：

- **对话历史可能过长**：跑了 30 分钟的多 agent 对话上下文可能就几十 KB 起步，恢复时要把它全塞回每个 agent 的 context
- **工具调用的中间态难处理**：一个 agent 正在调用搜索工具，途中崩了——重启后是\"再调一次\"还是\"假装已经调过了\"？没有干净的语义
- **agent 之间的协商可能没有自然 checkpoint**：状态机的 Phase 边界是预先画好的，多 Agent 的协商边界是 LLM 跑出来的，重启时\"从哪一步开始算\"本身就是个开放问题

我不是说多 Agent 框架不能做断点续做（LangGraph 的 checkpoint 机制其实就在做这件事），是说**它的恢复粒度天然比状态机粗**——状态机能在 Phase 间精确续做，多 Agent 一般只能从某个粗粒度 checkpoint 重放。对一个 60 分钟跑一次的任务，重放代价不可忽略。

### 3.2 成本必须按 Phase 分档——多 Agent 的 token 流向不可控

[`01-architecture-and-stack.md:83`](./01-architecture-and-stack.md) 讲过 Contritas 的 LLM 成本治理：按 Phase 路由不同模型。

```typescript
// packages/llm/src/router.ts 的核心思路
inputValidation     → 便宜模型，判断力够即可
decomposition       → Claude Opus（拆得不好后面全完）
evidenceExtraction  → 便宜模型（高频低成本的提取活）
crossValidation     → Claude（推理密集）
synthesis           → Claude（长输出 + 行文质量）
```

这套\"两档路由\"能 work 的前提是**每个 Phase 是一个独立、可计费、可换模型的盒子**。LLMProvider 接口在每个 Phase 入口被显式选择，token 用量、命中模型、成本分布都能干净地归集到 Phase 上。

多 Agent 模式下，单次会话里 N 个 agent 来回调用，token 流向是混在一起的。理论上你可以给每个 agent 单独指定模型——但实际碰到的问题是：

- **拆假设和\"挑剔拆假设的结果\"通常该用同档模型**，但分给两个 agent 之后，要么 Critic 也用 Opus（贵），要么 Critic 用便宜模型（挑不出来）
- **同一个 agent 在不同对话轮次里的难度不一样**，一个 Researcher Agent 第一轮做规划该用强模型，第二十轮做关键词改写该用便宜模型——但 agent 是个长期角色，不会自己降档
- **缓存命中边界变模糊**：Contritas 给 cross-validate / synthesize 开了 Anthropic prompt caching，因为这两个 Phase 的输入有大段稳定 prefix。多 Agent 的输入是上下文累积出来的，每次都不一样，缓存命中率显著下降

最后那条尤其要命。Phase 5 的 synthesis prompt 里证据列表是稳定的，输入前缀能撑 80%+ 的 cache hit。一旦把它拆成 Synthesizer Agent + Outline Agent + Polish Agent，每个 agent 看到的上下文都掺了对方的输出，**prefix 不稳定就没法缓存**——这个隐性成本通常比\"多一个 agent 调用\"显性成本大得多。

### 3.3 控制流必须可审计——多 Agent 把控制权交回给 LLM

[`04-vs-general-agent.md:40`](./04-vs-general-agent.md) 有一句话我现在还觉得很关键：

> 拆解、规划、综合是模型的母语能力，6-Phase pipeline 更多是把 LLM 隐式做的事**显式画出来**。

显式画出来的意义是什么？是**控制流由代码决定，不由 LLM 决定**。

Contritas 的状态机里，\"Phase 4 自检失败了就回退 Phase 3 重新检索\" 是一条 guard，写在代码里，永远成立。多 Agent 模式下，这件事变成 Critic Agent 说\"我觉得证据不够，建议 Researcher 再查一次\"——LLM 可能这么说，也可能说\"虽然证据有点弱但我觉得能出报告\"。**控制权在 LLM 手上**。

对很多场景这是优点（agent 自己判断什么时候够了，不用人写 guard）；对尽调，这是减分项。尽调的核心承诺是 PRD 里写的\"保证不放过你的盲点\"，这个承诺需要**确定性**的控制流来兑现，不能依赖 LLM 当场判断。

可审计性也建立在控制流确定的基础上。XState 的状态转换历史是一条干净的时间线：`validateInput → decompose → plan → retrieval → crossValidate → synthesize`。你可以看到每个状态花了多久、消耗了多少 token、调用了哪些工具。多 Agent 的执行轨迹是一棵树（agent A 调用 agent B，B 又调 C），事后复盘要先把这棵树压平才能讲清楚\"为什么这份报告长这样\"。

### 3.4 反讨好要求外部约束——多 Agent 容易内部共谋

这条最微妙，但对 Contritas 最致命。

[`02-anti-flattery-prompt-design.md`](./02-anti-flattery-prompt-design.md) 整篇都在讲一件事：LLM 默认是讨好的，你得用四道防线把\"反驳\"焊死在系统里。其中一道是 Phase 4 的交叉验证，强制要求\"同一假设有 2 条以上方向矛盾的证据时，必须标注矛盾\"。

直觉上，让 Critic Agent 来挑刺应该比单 Agent 自我挑刺更狠对吧？现实里有个反直觉的结果：**两个长期协作的 agent 容易达成隐性共识**。

这件事在多 Agent 研究文献里有讨论。当 Researcher 和 Critic 在同一个对话上下文里来回多轮，Critic 看到的不是冷冰冰的证据，是\"Researcher 已经辛苦工作了 10 轮\"的痕迹。LLM 对这种上下文是敏感的——它会倾向于\"在合理范围内认可对方的工作\"，因为这是社交对话的默认模式。

状态机给的反而是更严苛的环境：Phase 4 的 cross-validate actor 拿到的是\"一堆证据 + 一段 prompt\"，没有\"上一个 Phase 跑得多努力\"的痕迹，没有\"我们是同事要互相支持\"的暗示。它就是一个冷启动的、被强制要求挑矛盾的 LLM 调用。

[`03-phase4-cross-validation.md`](./03-phase4-cross-validation.md) 讲了 Phase 4 怎么用五道关把\"看看证据\"变成结构化工程问题。这五道关里有几条（强制矛盾标注、强制反向质疑覆盖）在多 Agent 协商语境下很难保住——Critic 在压力下\"放过\"一些矛盾，对它的 LLM 本能来说是更舒服的选择。

---

## 四、状态机已经吃下了多 Agent 真正的卖点

回头看第二节列的多 Agent 三个核心承诺，对照 Contritas 现状：

| 多 Agent 的承诺 | Contritas 怎么不靠 multi-agent 拿到 |
|---|---|
| **角色分工的 prompt 解耦** | 每个 Phase actor 有自己的 prompt 文件，自带边界——Phase 1 prompt 只关心\"拆假设\"，Phase 4 prompt 只关心\"找矛盾\"。Prompt 解耦不需要 agent 解耦 |
| **多视角的盲点覆盖** | Phase 1 prompt 强制\"反证优先\"（每个假设先问\"如果它不成立，会因为什么\"）；Phase 4 强制矛盾标注。多视角写进 prompt 而不是写成 agent |
| **动态协作的探索性** | XState parallel state 跑维度并行检索；guard + reentry 处理\"自检失败回退 Phase 3\"。需要的动态性是固定模式的，状态机能描述 |

也就是说，**多 Agent 框架解决的问题，Contritas 都解决了，只是用了更便宜、更可控的方式**。状态机不是多 Agent 的弱化版，是另一条路径——把控制流和内容生成分开：

- **控制流**：交给确定性的状态机
- **内容生成**：交给 LLM

多 Agent 是反过来——让 LLM 同时管控制流和内容。这件事在某些场景是必要的（比如下面要说的），但在尽调场景，是把可控性让给了灵活性，而尽调本身要的就是可控性。

---

## 五、那我什么时候会选多 Agent？

不能写成\"状态机吊打多 Agent\"——那是营销话术。我自己评估过几个场景，是会选多 Agent 的：

### 5.1 探索性任务，控制流没法预先画

比如\"帮我研究 XX 领域，看看有什么值得做的方向\"。这种任务的下一步取决于前一步发现了什么——一开始根本画不出状态图。多 Agent 的优势就是\"边跑边决定下一步\"。

Contritas 不是这种任务。用户输入一个具体命题，6 个 Phase 是固定的——状态机够用了。

### 5.2 需要长期协作 + 持久角色的任务

比如代码协作（一个 Architect Agent + 多个 Developer Agent + 一个 Reviewer Agent 长期跟一个项目），或者长期个人助理（Memory Agent + Planning Agent + Execution Agent 跨多天协作）。这类任务里\"agent 是一个有持续身份的实体\"，多 Agent 框架是天然语义。

Contritas 的每次研究都是一次性、无状态的，Phase 跑完就解散。给 Phase 安一个 agent 身份是过度建模。

### 5.3 用户深度参与的协商型任务

比如用户和系统反复来回讨论方案。这种场景下多 Agent 能更自然地处理\"用户提出新约束 → 部分 agent 重新工作 → 部分 agent 维持原结论\"的复杂交互。

Contritas 的用户交互是\"提交命题 → 离场 → 读报告\"（[`07-no-thinking-stream.md`](./07-no-thinking-stream.md)讲过）。中间偶尔追问一次，但不是持续协商。

### 5.4 团队规模带来的真协作收益

CrewAI / AutoGen 的早期论文里有些有意思的实验：5 个以上 agent 协作时，确实会涌现出单个 agent 拿不到的能力。但门槛是 \"5 个以上\"——3 个 agent 通常涌现不出什么，反而引入协调成本。

Contritas 真要拆 agent，按 Phase 拆能拆到 6 个，每个 agent 只做一次工作，不存在\"长期协作的涌现\"——这反而是 multi-agent 的负优化区间。

---

## 六、一句话总结

> **多 Agent 是糖，状态机是骨。**

骨是控制流的确定性、可恢复性、可审计性、成本可治理；糖是 agent 之间自由协商的灵活性。两者不是替代关系，是不同优先级的取舍。

如果你做的是探索性任务、协商型任务、或者长期协作型任务——糖更重要，多 Agent 是更好的答案。

如果你做的是 Contritas 这种\"对结果纪律性要求很高、长任务、成本敏感、要审计\"的任务——骨更重要。多 Agent 的灵活性反而是负债，状态机的约束才是它的产品价值。

最后说一句让多 Agent 拥趸不太开心的话：

> **如果你的 agent 不需要确定性的控制流、不需要可恢复、不需要成本分档、不需要可审计——那它解决的问题可能本来就不是工程问题，是 demo 问题。**

而 Contritas 的所有架构选择，都是为了让它能在工程问题上立得住——哪怕这意味着没法在 Twitter 上发\"我们的 multi-agent 系统跑出了 X\"这种 viral 的东西。

---

## 七、留个口子：未来会不会改？

诚实地说：**会**，但不是变成现在主流意义上的\"多 Agent 协作\"，而是在两个具体方向上引入有限的 agent-like 结构。

### 7.1 Phase 1 / Phase 5 可能内部拆成\"双视角 agent\"

Phase 1（拆假设）和 Phase 5（综合报告）现在都是单次 LLM 调用，prompt 里塞了\"既要正面又要反面\"的指令。如果未来真的发现 LLM 在同一次调用里做\"正方 + 反方\" 还是有讨好倾向，会考虑把这两个 Phase 内部拆成\"Bull LLM + Bear LLM + Judge LLM\"——但这是 Phase 内部的实现细节，对外仍然是一个 Phase，仍然有状态机边界。

这不是 multi-agent 架构，是\"Phase 内部的多次 LLM 调用\"。区别在于：每次调用仍然是确定性触发的，没有 agent 自由协商的语义。

### 7.2 用户协商场景可能引入小型 agent loop

未来如果加\"用户能和报告对话深挖\"这种功能（类似 Perplexity 的 Discover），那个交互场景本身适合 agent loop——用户提问、agent 决定要不要重新搜、要不要改写结论。

但这是**报告生成完之后**的交互层，跟 6 Phase 主流程是解耦的。主流程仍然是状态机。

---

下一篇候选：
- **AI Agent 的 LLM 成本治理：Model Router + Token 预算 + 缓存三件套** —— 等真实成本数据攒齐
- **长任务的实时进度推送：SSE + Redis Stream + Last-Event-ID 补发** —— Phase 6.4 加固完后再写

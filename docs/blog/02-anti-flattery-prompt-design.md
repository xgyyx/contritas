# 怎么让 LLM 跟你唱反调——Contritas 是怎么把"反驳"写进 Prompt 的

> 本系列上一篇：[《我做了一个会跟你唱反调的 AI 尽调 Agent——聊聊 Contritas 的架构与选型》](./01-architecture-and-stack.md)

---

## 一、所有 Prompt 工程都在教 LLM 听话

我翻了翻这两年读过的 Prompt 工程文章，绝大部分母题是同一个：

> 如何让 LLM 更准确地理解我的意图、更稳定地输出我想要的结果。

这是一种**讨好式工程**——你定义"想要什么"，然后想办法让模型贴近它。

可一旦切到决策辅助场景，这种讨好就变成毒药。用户问"我的方案行不行"，他**潜意识里就是想被支持**——你的 prompt 越擅长贴合用户意图，输出就越像鼓励，离真正的尽调就越远。

Contritas 想反过来做一件事：**在 prompt 层面就把反驳写进去**，让 LLM 不能不挑刺、不能不找矛盾、不能不解释"为什么不更高分"。

下面具体说怎么做的。

---

## 二、第一步：把"判断"拆成"假设"

普通问答 Agent 的 Phase 1 通常是"理解用户意图"。Contritas 的 Phase 1 是**假设拆解**——这是整个反驳机制的根。

`packages/llm/src/prompts/phase1-decompose.ts` 的核心提示词：

```text
Given a validated research proposition, extract all implicit and explicit
assumptions that the proposition relies on. Each assumption should be
independently verifiable.

Guidelines:
1. Extract 3-8 assumptions
2. Classify each assumption as:
   - factual: Can be verified with data/evidence
   - judgmental: Requires evaluation/comparison
3. Rank importance as:
   - high: If this assumption is wrong, the entire proposition collapses
   - medium: Significant impact on the proposition's validity
   - low: Nice to verify but not critical
```

注意三个细节：

**第一，"假设"而不是"问题"。** 假设是一句**可以被证伪的陈述**，问题不是。"Rust 性能比 Go 强吗"是问题，"Rust 比 Go 更适合构建高并发 Web 服务"是命题，**而拆出来的是"Rust 和 Go 都有生产级 Web 框架"、"高并发是现代 Web 服务的关键需求"、"Rust 的内存模型在并发场景有性能优势"** ——每一条都能用证据回答 yes 或 no。

只有可证伪的东西才能被反驳。

**第二，事实 vs 判断的二分法**。看 prompt 里的例子：

> - (factual, high) Rust and Go both have production-ready web frameworks
> - (judgmental, medium) The performance difference is significant enough to matter in practice

**事实性假设**直接交给检索去回答；**判断性假设**则需要在报告里明确标记"这是基于推理，不是基于事实"。这一刀切下去，后面再怎么生成，"事实"和"判断"在最终报告里就不会被混淆——这是反幻觉的第一道防线。

**第三，importance 不是 nice-to-have 标签**。它的语义是：

> If this assumption is wrong, the entire proposition collapses.

注意这里的视角——它不问"这个假设有多重要"（这是用户视角），它问**"如果这个假设崩了，整件事会不会完蛋"**（这是审计视角）。第一个视角倾向于把每条都标成"重要"，第二个视角逼 LLM 找最脆弱的那个支柱。

后面 Phase 3 的检索预算就是按这个 importance 分的——高重要性维度多搜几轮，低重要性维度可以只搜满最低门槛。**不是所有假设都值得平均用力，最该被打的是最致命的那一根。**

---

## 三、第二步：每个维度都必须配一个反向质疑

Phase 2 规划阶段，每个研究维度的产出都包含三个字段：**名称、核心问题、反向质疑**。

这第三个字段是 prompt 里反复强调的硬约束。在 Phase 5 综合报告的 prompt 里它甚至被写成大写：

```text
For EACH dimension, include ALL of these sub-sections:
- 核心问题: 1-2 sentences
- 反向质疑 (MANDATORY): 2-3 counter-questions —
  "What would make this assumption fail?"
- 证据与观察: ...
- 分析与推论: ...
- 阶段性结论: ...
```

**MANDATORY** 这个词在整个 prompt 文件里出现了好几次。LLM 对全大写指令敏感，配合上 self-check 阶段对"反向质疑"小节的硬性正则校验（缺一个维度就不通过），LLM 学会了一件事：

> 写报告的时候漏掉反向质疑会被打回重写。

Self-check 的代码就在 `packages/workflow/src/utils/self-check.ts`：

```typescript
function checkCounterQuestions(
  markdown: string,
  context: ResearchContext,
  failures: SelfCheckFailure[]
): void {
  const counterQuestionPattern = /#{1,4}\s*(反向质疑|Counter[-\s]?[Qq]uestion)/g;
  const matches = markdown.match(counterQuestionPattern) ?? [];
  const dimensionCount = new Set(context.evidence.map((e) => e.dimensionId)).size;

  if (matches.length < dimensionCount) {
    failures.push({
      check: "counter_questions",
      reason: `Found ${matches.length} counter-question sections but expected ${dimensionCount} (one per dimension)`,
    });
  }
}
```

这是 **prompt + 代码双重保险**的典型模式：

- Prompt 让 LLM "知道要写"
- 代码让 LLM "不写就被打回"

光靠 prompt 是不够的，模型偶尔会偷懒；光靠代码也不够，正则只能验存在性、不能验内容质量。两者绑在一起，"反向质疑必须有"才从软约束变成硬约束。

---

## 四、第三步：把矛盾归类成有限的几个类型

Phase 4 交叉验证是另一个关键设计。普通做法是让 LLM "看看这些证据有没有矛盾"——结果就是模型很容易给出 "整体一致" 这种敷衍答案。

Contritas 做了一件事：**给矛盾原因一个枚举，强迫 LLM 在四个具体类型里挑一个**。看 schema：

```typescript
contradictionReason: z.enum([
  "source_bias",
  "time_difference",
  "scope_mismatch",
  "methodology_difference",
])
```

Prompt 里对应的解释：

```text
- source_bias       — 一个来源有明显的利益相关
                      (如公司 PR vs 独立分析)
- time_difference   — 不同时间段的证据反映了已变化的条件
- scope_mismatch    — 证据讨论的范围/地区/细分不同
- methodology_difference
                    — 不同的测量方法或定义产生了不同的数字
```

这个改动看起来很小，但效果完全不一样。

**枚举强迫 LLM 把"模糊感觉"具象化成"分类决策"。** 让 LLM 写自由文本——"这两条证据似乎方向不同"——它会写得很滑头，看着像分析其实啥也没说。让它从四个原因里挑一个——"这是 methodology_difference，因为来源 A 用 GAAP 口径，来源 B 用 non-GAAP"——它就不得不**调出脑子里关于 GAAP 和 non-GAAP 区别的具体知识**来支撑这个分类。

这跟应试教育里"选择题比简答题更容易分辨学生是真懂还是装懂"是同一个原理。

更妙的是：**每一个分类都对应一个不同的处置方式**。

- `source_bias` → 在报告里标注，并优先采信独立来源
- `time_difference` → 用更近的数据
- `scope_mismatch` → 拆开报告，分别在对应口径下给结论
- `methodology_difference` → 必须在评分说明里展示口径差异

后面合成报告时，prompt 会根据这个分类生成对应的处置叙述。**枚举不是为了好看，是为了让下游有可被分发的信号。**

---

## 五、第四步：评分必须解释"为什么不更高/不更低"

Phase 5 报告生成 prompt 里最反直觉的约束：

```text
Score explanation MUST explain:
1. Why the score is what it is
2. Why NOT higher (what evidence/conditions are missing)
3. Why NOT lower (what supporting evidence exists)
```

为什么要这么设计？

LLM 给一个分数后，自然倾向于**只解释为什么是这个分数**——这等于让它自圆其说，永远只往一边滑。

但"为什么不更高"和"为什么不更低"是两个**反方向**的论证，必须分别拿出能对抗当前分数的证据。这相当于强迫 LLM 模拟两个对立的辩论位置：

- "你为什么不给 8 分？" → 必须列出**支持更高分**的论据，然后解释为什么这些不够
- "你为什么不给 5 分？" → 必须列出**反对更高分**的论据，然后解释为什么不至于这么低

分数从一个"判决"变成了一个**两头都被拷问过的均衡点**。

这一招借鉴了金融分析师的内部研报风格——专业研报永远是"看多理由 N 条 / 看空理由 N 条 / 综合判断 X"，不是简单一个 buy/hold/sell。

Self-check 同样会在最后做一遍正则校验，缺了"为什么不更高/更低"小节直接打回：

```typescript
const hasWhyNotHigher = /为什么不是更高|why not higher|不是更高/i.test(scoreSection);
const hasWhyNotLower  = /为什么不是更低|why not lower|不是更低/i.test(scoreSection);

if (!hasWhyNotHigher && !hasWhyNotLower) {
  failures.push({
    check: "score_explanation",
    reason: "Score explanation does not include 'why not higher' and 'why not lower' analysis",
  });
}
```

---

## 六、第五步：一票否决——给 LLM 一根硬刹车

Prompt 里有这么一段，专门处理"高分掩盖致命问题"的情况：

```text
### One-Veto Rule (CRITICAL)
If the proposition violates confirmed law, has a physically impossible
core dependency, or its key premise contradicts a confirmed fact —
the score MUST be capped at 4.0 regardless of how well other dimensions score.
```

为什么要专门写这条？

LLM 评分有个**平均化倾向**——把多个维度按权重加权求和，导致一两个致命问题被一堆中性维度"稀释"掉。比如某个 SaaS 项目所有商业维度都很正面（市场大、增速快、团队强），但合规上违反了一条明确的法律——按加权评分可能还能拿 7 分，可现实里这是不能做的事。

一票否决条款的作用是：**给 LLM 一根硬刹车，让它在遇到红线时直接锁死分数上限**，而不是用其他维度的高分把它"平均"过去。

这条规则放在 prompt 里被标了 CRITICAL。配合"违法 / 物理不可能 / 与已证实事实矛盾"三个明确触发条件，LLM 得到了一个清晰的判断框架：什么情况下**评分不再是连续的，而是离散的**。

---

## 七、第六步：MUST DO / MUST NOT 两栏对照

Phase 5 prompt 末尾有一段非常老派的指令：

```text
MUST DO:
- Every dimension MUST include a 反向质疑 section
- Every conclusion MUST reference 3+ evidence items, with at least 1 high-credibility
- Distinguish fact, inference, and judgment in analysis text
- Annotate uncertainty and missing information

MUST NOT:
- Only find supporting evidence (confirmation bias) — actively look for counter-evidence
- Treat marketing materials as high-credibility sources
- Use a single case as general proof
- Mix data from different scopes (gross vs net, total vs subset)
- Give high-confidence conclusions with insufficient evidence
- Omit findings unfavorable to the user
```

很多 prompt 工程文章在教"少用否定句、多用肯定句"。Contritas 反过来：**所有最重要的反驳约束都用否定句正面挂出来**。

为什么？因为**反驳本质上就是"不做某些事"的纪律**。

- "积极寻找反证" 是正向行为，但容易被忽略
- "不要只找支持性证据" 是反向纪律，是**对最容易犯的错误的明确禁止**

后者比前者更有约束力，因为它直接对标了模型的默认行为——**LLM 默认就是会偷懒只找支持性证据**，你不挂这条 MUST NOT，它就照常偷懒。

最后一条 "Omit findings unfavorable to the user" 尤其重要。这是大多数 AI 工具的**隐性默认行为**——不利于用户的发现倾向于被淡化、被加缓冲句、被包装成"也有支持的看法"。Contritas 把这条写成 MUST NOT 直接禁掉。

---

## 八、四道防线，把"反驳"焊死在系统里

回头看，Contritas 的"反驳"机制其实分布在四个不同的层级上，没有一处是单点：

```
Prompt 层 ──┐
            ├──→ 引导 LLM "知道要反驳"
模型默认 ──┘

Schema 层 ────→ 强迫 LLM 把模糊判断具象化成枚举决策
                (contradictionReason / verdict / confidence)

代码 self-check ─→ 反向质疑、证据数量、评分解释、来源表
                  缺一不可，正则硬校验，不通过回退

工作流 ───→ 自检失败时回退 Phase 3 补充检索
            (XState 的 guard + retry)
```

任何一层单独存在都不够：

- 只有 prompt：模型偶尔偷懒，输出会塌方
- 只有 schema：LLM 能填满字段但敷衍内容
- 只有 self-check：正则验得了存在性，验不了质量
- 只有工作流：回退条件触发不了就白搭

四层叠在一起，"反驳"才从一个 prompt 里的软指令变成一个**系统性属性**。

---

## 九、对其他 Agent 设计者的几条建议

如果你也在设计需要 LLM "保持独立判断"的 Agent，下面这几条可以拿走用：

**1. 永远要有一个"假设"层**。 不要让 LLM 直接对用户的问题/方案给意见，先把它拆成可证伪的陈述列表。**只有可证伪的东西才能被严肃讨论。**

**2. 把模糊判断都换成 enum**。 自由文本是 LLM 的舒适区，枚举是它的考场。不要让模型自由抒情，让它做选择题。

**3. 每个关键约束都用 prompt + 代码双重保险**。 Prompt 说"必须做"是软约束；代码 self-check 验不到就打回是硬约束。两者必须同时存在。

**4. 评分要强制双向解释**。 让 LLM 同时回答"为什么不更高"和"为什么不更低"——这是把它拽出"自圆其说"舒适区的最便宜的办法。

**5. MUST NOT 比 MUST DO 更重要**。 模型默认行为的反面，必须在 prompt 里被明确禁止，否则它会照默认来。

**6. 给系统一根硬刹车**。 一票否决 / 红线规则 / 硬性上限——任何能跳出"加权平均"的硬约束机制都是值得的。

---

## 十、下一篇

下一篇会更聚焦——专门讲 Phase 4 交叉验证：怎么把 LLM 的"看看证据"变成一个有结构化输入、有归因分类、有 verdict 与 confidence 解耦的工程化机制，以及代码上具体怎么实现。

如果对这个项目感兴趣：

> GitHub: [Contritas](https://github.com/wb-yyx453122/Contritas)
>
> Slogan: _Grind assumptions. Surface truth._

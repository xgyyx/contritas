# Blog Backlog · 选题规划

> 这个文件记录 Contritas 博客的待写选题与排期。每完成一篇就把对应条目搬到 [`README.md`](./README.md) 索引中，并在此处更新状态。

## 选题分梯队

按"独特性 × 工程深度 × 写作准备度"重新评估，越靠前越值得优先写。已发布的归档放在最后；新增选题（A / B）插在对应梯队中。

### 🥇 第一梯队（下一步就动手）

#### 3. AI Agent 的 LLM 成本治理：Model Router + Token 预算 + 缓存三件套

- **状态**：📝 待写（**等真实数据**）
- **核心命题**：让 Agent 跑通是几十行代码的事，让它不烧钱才是工程量。
- **触发条件**：先攒 5-10 次实际研究的 token / 美元数据，否则核心论据缺失，写出来是空话。
- **可贴的素材**：
  - `packages/llm/src/router.ts`：按 phase 路由的配置结构
  - 每个 phase 的成本/价值权衡分析（推理密集型 vs 高频提取型）
  - `budgetExceeded` 终态的设计——为什么需要"主动止损"而不是"事后告警"
  - 24h 搜索缓存 + 7 天 LLM 响应缓存的 trade-off（结论一致性 vs 时效性）
  - **真实成本数据**（必备）：单次研究 token 分布 / 美元区间 / 各 phase 占比
  - 可顺带回收 #4 中"`fromPromise` 怎么影响 token 计费"的素材
- **目标读者**：所有做 AI 应用的工程师，受众最广
- **预估篇幅**：4000-5000 字

### 🥈 第二梯队（工程进度满足后再写）

#### 5. 长任务的实时进度推送：SSE + Redis Stream + Last-Event-ID 补发

- **状态**：📝 待写（等 Phase 6.4 全部加固完）
- **核心命题**：通用工程主题，不限 AI 应用。任何"用户提交后要等几分钟以上"的场景都用得上。
- **差异化要点**：技术上不算新——SSE 教程市面上够多了。差异化要靠"7 种事件类型怎么设计"这种**产品化角度**，不能只写协议层
- **可贴的素材**：
  - SSE vs WebSocket 的 trade-off 表
  - 7 种事件类型的设计（phase_change / dimension_update / search_executed / evidence_added / eta_update / report_ready / error）
  - Redis Stream 持久化 + XRANGE 补发
  - 心跳保活、CDN 友好
  - 客户端 useResearchStream hook 的实现
- **目标读者**：全栈工程师、做 SaaS 实时通信的人
- **预估篇幅**：3000-4000 字

### 🥉 第三梯队（依赖工程进度）

#### 7. AI Agent 的生产化加固清单——Phase 6 复盘

- **状态**：⏳ 等 Phase 6 至少完成 8/10（当前 6/10）
- **核心命题**：把 6.1～6.10 这十个子领域踩过的坑串起来——安全鉴权、数据一致性、Worker 稳定性、SSE 可靠性、LLM 可靠性、可观测性、测试覆盖、容器化、DX、文档同步。
- **可顺便吸收**：#4 XState 中"状态机回退逻辑"那段素材
- **可贴的素材**：完整的 [`docs/progress/phase6-progress.md`](../progress/phase6-progress.md)
- **预估篇幅**：5000-7000 字（系列文章首选）

### ❄️ 暂缓 / 合并

#### 4. 用 XState v5 编排 AI Agent 工作流 ❄️

- **状态**：暂缓，建议**拆解后并入其他文章**
- **原因**：XState 学习曲线高、受众窄；写得浅了像教程文，写得深了读者跟不上，单写一篇 ROI 不够
- **拆分去向**：
  - `fromPromise` / actor 模型 → 并入 #3 成本治理（讲并发对 token 计费的影响）
  - 状态机回退、snapshot 序列化恢复 → 并入 #7 Phase 6 加固复盘
- **若坚持单写**：等 Contritas 真在生产环境踩了 XState 的非典型坑（不是教程坑），素材足够再写

#### 8. 从 PRD 到代码：尽调方法论怎么落到 6 个 Phase 上 ❄️

- **状态**：暂缓
- **原因**：和 04 号《如果你能用 Claude Code》主题重叠太多——04 已经讲了"承诺 → 工程兑现"的核心叙事，再写一篇会稀释
- **更好的去处**：把素材并入未来的姊妹篇——**"PE 尽调 / 技术选型 rubric 怎么落到 Phase 1-3 模板"**。但那篇要等 Contritas 真做出可插拔的领域 rubric 才能动笔（参见 04 号"长期护城河"章节）

### ✅ 已发布（归档）

#### 1. 如何让 LLM 主动跟你唱反调——Prompt 与流程双重设计

- **状态**：✅ 已发布 → [`02-anti-flattery-prompt-design.md`](./02-anti-flattery-prompt-design.md)
- **核心命题**：市面上 90% 的 AI 工程教你怎么让 LLM 听话。这篇反过来：怎么让它结构性地反对用户。

#### 2. Phase 4 交叉验证：让 LLM 找证据矛盾而不是顺事实线

- **状态**：✅ 已发布 → [`03-phase4-cross-validation.md`](./03-phase4-cross-validation.md)
- **核心命题**：交叉验证不是"再问 LLM 一次"，而是一套结构化的证据组织 + 矛盾归因 + 评级映射机制。

#### 04. 如果你能用 Claude Code，为什么还要 Contritas？

- **状态**：✅ 已发布 → [`04-vs-general-agent.md`](./04-vs-general-agent.md)
- **核心命题**：诚实承认通用 Agent 能拿 70-80% 报告，把剩下 20-30% 拆成五件具体的事，并指出长期护城河方向（rubric 沉淀 / 跨研究证据复用 / 非开发者形态）。

#### 05. 搜索降级链与"接受部分缺失"的工程纪律

- **状态**：✅ 已发布 → [`05-search-fallback-and-evidence-discipline.md`](./05-search-fallback-and-evidence-discipline.md)
- **核心命题**：搜索两级 + 抓取三级降级，缓存边界设计，以及"证据不足"作为合法尽调结果的产品纪律——不掩盖缺失。
- **后续待补**：抓取失败率真实数据（待埋点统计后单独出一篇带数字的复盘）

#### 06. 报告自检（Phase 5 self-check）—— 让 LLM 给自己挑刺

- **状态**：✅ 已发布 → [`06-phase5-self-check.md`](./06-phase5-self-check.md)
- **核心命题**：自检不该用 LLM 评 LLM。四道纯代码硬约束（反向质疑覆盖 / 证据覆盖 / 来源表 / 评分双向解释）+ 失败回退 Phase 3 的状态机，把"能用规则查的"和"判断对错的"严格分离。是反讨好系列的最后一块拼图。

#### 07. 为什么 Contritas 不做"实时浏览/深思考演示"？

- **状态**：✅ 已发布 → [`07-no-thinking-stream.md`](./07-no-thinking-stream.md)
- **核心命题**：用户在长任务里需要的进度信号只有三类（在哪一步 / 没死 / 还要多久），不需要看 Agent 在搜什么、想什么。审计口径 vs 表演口径——Contritas 选前者，明确不做 Devin/Manus 式的实时演示流。

#### 08. 多 Agent 是糖，状态机是骨

- **状态**：✅ 已发布 → [`08-single-agent-vs-multi-agent.md`](./08-single-agent-vs-multi-agent.md)
- **核心命题**：尽调的四个硬约束（确定性、审计性、可控成本、可恢复）每一个都与多 Agent 协作打架。单 Agent + 多 Phase 状态机不是落伍，是有意识的架构选择。

#### 09. 让 Agent "等用户说话"——长任务里的 clarification / iterate 异步交互

- **状态**：✅ 已发布 → [`09-clarification-and-iterate-async.md`](./09-clarification-and-iterate-async.md)
- **核心命题**：长任务 Agent 中途要追问用户怎么实现？Job 阻塞 + Redis Pub/Sub 唤醒 + extendLock 保活，把"暂停-恢复"做成一个函数；而事后 iterate 应该 fork 新 session，不要混为一谈。两套场景，两套机制。

## 写作原则

- **公众号 / 技术博客口吻**：可以有"我"、可以讲故事、有节奏感
- **细节要可验证**：贴代码、贴 prompt、贴文件路径，引用都链回仓库内文件
- **每篇 ≤ 5000 字**：超过这个长度建议拆系列
- **首尾呼应**：每篇结尾埋下一篇的钩子（已在第 01 篇验证过这个套路有效）
- **诚实**：踩过的坑要写出来，不要把"演化路径"包装成"先见之明"

## 索引同步

新发布的文章必须同时更新：
1. [`docs/blog/README.md`](./README.md) — 文章列表表格
2. [根 README](../../README.md) — "想读懂产品"区块（如适用）
3. 本文件对应条目的状态从 📝/⏳ 改为 ✅，附文件链接

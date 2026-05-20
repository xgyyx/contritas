# Blog Backlog · 选题规划

> 这个文件记录 Contritas 博客的待写选题与排期。每完成一篇就把对应条目搬到 [`README.md`](./README.md) 索引中，并在此处更新状态。

## 选题分梯队

按"独特性 × 工程深度 × 写作准备度"排序，越靠前越值得优先写。

### 🥇 第一梯队（差异化最强）

#### 1. 如何让 LLM 主动跟你唱反调——Prompt 与流程双重设计

- **状态**：✅ 已发布 → [`02-anti-flattery-prompt-design.md`](./02-anti-flattery-prompt-design.md)
- **核心命题**：市面上 90% 的 AI 工程教你怎么让 LLM 听话。这篇反过来：怎么让它结构性地反对用户。
- **可贴的素材**：
  - Phase 1 拆假设 prompt（事实性 vs 判断性、importance ranking）
  - Phase 4 contradictionReason 四分类（source_bias / time_difference / scope_mismatch / methodology_difference）
  - Phase 5 "为什么不更高 / 为什么不更低" 的强制约束 + self-check 校验
  - One-Veto Rule 的设计思路
- **目标读者**：AI 应用工程师、Prompt Engineer、对 Agent 设计感兴趣的产品经理
- **预估篇幅**：3500-4500 字

#### 2. Phase 4 交叉验证：让 LLM 找证据矛盾而不是顺事实线

- **状态**：✅ 已发布 → [`03-phase4-cross-validation.md`](./03-phase4-cross-validation.md)
- **核心命题**：交叉验证不是"再问 LLM 一次"，而是一套结构化的证据组织 + 矛盾归因 + 评级映射机制。
- **可贴的素材**：
  - `packages/workflow/src/actors/cross-validate.ts`：按 supports/weakens/qualifies 三分组的输入构造
  - `phase4OutputSchema` 的字段设计（consistent / contradictionReason / verdict / confidence）
  - 三级 verdict（supported / disputed / unsupported）与 confidence 的解耦
  - self-check 里 evidence_coverage 的硬约束
- **目标读者**：构建 Agent 的开发者、做 RAG / 知识库的人
- **预估篇幅**：3000-4000 字

#### 3. AI Agent 的 LLM 成本治理：Model Router + Token 预算 + 缓存三件套

- **状态**：📝 待写
- **核心命题**：让 Agent 跑通是几十行代码的事，让它不烧钱才是工程量。
- **可贴的素材**：
  - `packages/llm/src/router.ts`：按 phase 路由的配置结构
  - 每个 phase 的成本/价值权衡分析（推理密集型 vs 高频提取型）
  - `budgetExceeded` 终态的设计——为什么需要"主动止损"而不是"事后告警"
  - 24h 搜索缓存 + 7 天 LLM 响应缓存的 trade-off（结论一致性 vs 时效性）
  - 真实成本数据（如有）：单次研究 token 分布 / 美元区间
- **目标读者**：所有做 AI 应用的工程师，受众最广
- **预估篇幅**：4000-5000 字

### 🥈 第二梯队（工程价值高，受众更窄）

#### 4. 用 XState v5 编排 AI Agent 工作流——比 if/else 强在哪，又坑在哪

- **状态**：📝 待写
- **核心命题**：不是所有 Agent 都需要状态机，但 Contritas 这样多阶段、可中断、可回退的流程必须用。
- **可贴的素材**：
  - 主状态机的状态枚举（inputValidation → ... → completed/failed/cancelled/budgetExceeded）
  - Phase 3 维度并行 + 子状态机
  - 回退逻辑（synthesis 自检失败 → 回 Phase 3，最多 1 次）
  - snapshot 序列化恢复
  - XState 的学习曲线坑：actor 模型、guard 函数、`fromPromise`
- **目标读者**：TS 社区、状态机爱好者、做工作流引擎的人
- **预估篇幅**：3500-4500 字

#### 5. 长任务的实时进度推送：SSE + Redis Stream + Last-Event-ID 补发

- **状态**：📝 待写
- **核心命题**：通用工程主题，不限 AI 应用。任何"用户提交后要等几分钟以上"的场景都用得上。
- **可贴的素材**：
  - SSE vs WebSocket 的 trade-off 表
  - 7 种事件类型的设计（phase_change / dimension_update / search_executed / evidence_added / eta_update / report_ready / error）
  - Redis Stream 持久化 + XRANGE 补发
  - 心跳保活、CDN 友好
  - 客户端 useResearchStream hook 的实现
- **目标读者**：全栈工程师、做 SaaS 实时通信的人
- **预估篇幅**：3000-4000 字

#### 6. 搜索降级链与"接受部分缺失"的工程纪律

- **状态**：📝 待写
- **核心命题**：AI 应用最容易被忽略的工程纪律是"宁可少证一条，不可错证一条"。
- **可贴的素材**：
  - Tavily → Serper / Jina → Firecrawl → Web Archive 的两层降级
  - 搜索缓存 24h 的 key 设计
  - "证据不足" 标注 vs 伪造证据的产品边界
  - 实际抓取失败率数据（如有）
- **目标读者**：做 Search / RAG / 数据采集的人
- **预估篇幅**：2500-3500 字（偏短文）

### 🥉 第三梯队（依赖工程进度）

#### 7. AI Agent 的生产化加固清单——Phase 6 复盘

- **状态**：⏳ 等 Phase 6 全部完成
- **核心命题**：把 6.1～6.10 这十个子领域踩过的坑串起来——安全鉴权、数据一致性、Worker 稳定性、SSE 可靠性、LLM 可靠性、可观测性、测试覆盖、容器化、DX、文档同步。
- **可贴的素材**：完整的 [`docs/progress/phase6-progress.md`](../progress/phase6-progress.md)
- **触发条件**：Phase 6 至少完成 8/10
- **预估篇幅**：5000-7000 字（系列文章首选）

#### 8. 从 PRD 到代码：尽调方法论怎么落到 6 个 Phase 上

- **状态**：📝 待写（产品向）
- **核心命题**：业务方法论 → 工程抽象的过程拆解。受众偏产品社区。
- **可贴的素材**：
  - PRD 第二节的 6 条核心原则 → Phase 流水线的对应关系
  - "深度优先于广度" 怎么映射到检索预算分配
  - "审计口径" 怎么映射到 prompt 强约束
- **目标读者**：产品经理、AI 产品设计者
- **预估篇幅**：3500-4500 字

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

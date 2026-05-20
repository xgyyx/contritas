# Phase 5：优化与扩展 — 进度

> 对应 [roadmap.md](./roadmap.md) Phase 5

---

## 完成清单

### 1. Model Router 按 Phase 路由 ✅

- `packages/llm/src/router.ts` — `ModelRouter` 类（已有）
- `packages/workflow/src/types.ts` — `WorkflowDeps.llmModel` → `getModelForPhase(phase: PhaseId) => string`
- 6 个 actor 文件均已改用 `deps.getModelForPhase("对应phaseId")`
- `apps/api/src/services/workflow.service.ts` — 通过 `createDefaultRoutingConfig()` 实例化 `ModelRouter`，默认所有 phase 用同一模型，支持通过 `ModelRoutingConfig` 自定义

### 2. 成本监控与 Token 预算机制 ✅

- `packages/shared/src/constants.ts` — 新增 `DEFAULT_TOKEN_BUDGET_USD = 2.0`
- `packages/workflow/src/types.ts` — `WorkflowDeps` 新增 `tokenBudgetUSD?: number`
- `packages/workflow/src/machine.ts` — 新增 `budgetExceeded` final state + 预算 guard
  - 在 decomposition → planning、planning → retrieval、validation → synthesis 三个转换点检查预算
  - 超出预算时发送 `error` 事件并进入 `budgetExceeded` 终态
- `apps/api/src/jobs/research.job.ts` — `budgetExceeded` 映射为 `"failed"` 状态

### 3. 搜索结果缓存优化 ✅

- `packages/search/src/cache.ts` — `buildCacheKey` 增加 `provider` 参数，避免跨 provider 缓存误命中
- `packages/search/src/cache.ts` — 新增 `RedisContentCache` 类（URL → ExtractedContent）
- `packages/search/src/types.ts` — 新增 `ContentCache` interface + `SearchOrchestratorConfig.contentCache`
- `packages/search/src/orchestrator.ts` — content extraction 前先查 contentCache，成功后写入
- `packages/workflow/src/types.ts` — `SearchDeps` 新增 `contentCache`
- `apps/api/src/services/workflow.service.ts` — `buildSearchDeps` 创建 `RedisContentCache`

### 4. Bug 修复

#### ETA 事件发射 ✅

- `packages/workflow/src/types.ts` — `WorkflowEmittedEvent` 新增 `eta_update` 变体
- `packages/workflow/src/machine.ts` — planning 完成后发射 `eta_update`（使用 LLM 估算的 `estimatedMinutes * 60`）
- `apps/api/src/services/workflow.service.ts` — `emitEvent` switch 新增 `case "eta_update"`

#### 迭代研究（Iterate）修复 ✅

- `apps/api/src/services/session.service.ts` — `CreateSessionParams` 增加 `parentSessionId`；新增 `getAssumptions`、`getDimensions` 查询
- `apps/api/src/routes/research.ts` — iterate 路由：创建子 session 后再入队；job name 改为 `"research"`
- `packages/workflow/src/machine.ts` — `createResearchMachine` 支持 `initialState` 可选参数
- `apps/api/src/services/workflow.service.ts` — 新增 `createIterateContext()`（加载父 session 数据构建初始 context）和 `createWorkflowControllerFromContext()`
- `apps/api/src/jobs/research.job.ts` — `processResearchJob` 检测 `parentSessionId`，走迭代流程
  - `deep_dive`：复用父 session 全部数据，从 `retrieval` 阶段开始，设 `targetedDimensions`
  - `add_dimension`：复用 assumptions，从 `planning` 阶段开始

---

## 技术变更汇总

| 文件 | 变更类型 |
|------|----------|
| `packages/shared/src/constants.ts` | 新增预算常量 |
| `packages/workflow/src/types.ts` | `WorkflowDeps` 重构、`WorkflowEmittedEvent` 扩展、`SearchDeps` 扩展 |
| `packages/workflow/src/machine.ts` | 预算 guard + budgetExceeded 状态 + ETA 发射 + initialState 参数 |
| `packages/workflow/src/actors/*.ts` | 6 个 actor 改用 `getModelForPhase` |
| `packages/search/src/types.ts` | 新增 `ContentCache` interface |
| `packages/search/src/cache.ts` | `RedisContentCache` + `buildCacheKey` 改进 |
| `packages/search/src/orchestrator.ts` | content cache 集成 + cache key 含 provider |
| `packages/search/src/index.ts` | 导出 `RedisContentCache` |
| `apps/api/src/services/session.service.ts` | parentSessionId 支持 + 新查询方法 |
| `apps/api/src/services/workflow.service.ts` | ModelRouter 接入 + token budget + iterate context + content cache |
| `apps/api/src/routes/research.ts` | iterate 路由修复 |
| `apps/api/src/jobs/research.job.ts` | iterate job 处理 + budgetExceeded 状态映射 |

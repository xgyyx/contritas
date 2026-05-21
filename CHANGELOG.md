# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 格式。

## [Unreleased]

### Planned — Phase 6 收尾批
- BullMQ 幂等保护 + DLQ 监控（6.3.4 / 6.3.6）
- 请求日志中间件 / `/metrics` Prometheus 端点 / Sentry / health check 扩展（6.6.4-6.6.7）
- workflow actor 单测 / web 组件测试 / BullMQ 行为回归（6.7.2 / 6.7.3 / 6.7.6）
- Dockerfile HEALTHCHECK 指令 + 自动 migration（6.8.3 / 6.8.7）
- pre-commit / ESLint flat config / `noUncheckedIndexedAccess` / dev.sh worker 拉起（6.9.2-6.9.6）
- 文档收尾：deployment 加固说明、各 README 同步、data-model 索引更新（6.10.x）

---

## [0.6.0] - 2026-05-21

> Phase 6 加固与生产就绪（Sprint A / B / C），完成 6.1-6.4 + 6.5 + 6.6.1-6.6.3 + 6.7.1/6.7.4 + 6.8 容器加固七项 + 6.9.1 CI。详见 `docs/progress/phase6-progress.md`。

### Added — Sprint C: LLM 可靠性与成本（6.5）
- **Structured Output 原生路径**：Claude provider 走 `tool_use` + `tool_choice: { type: "tool", name: "respond" }`；OpenAI-compatible provider 走 `response_format: { type: "json_schema", strict: true }`，strict 失败回退 non-strict，再失败回退 prompt-only。新增 `zod-to-json-schema` 依赖，helper 在 `packages/llm/src/structured/{json-schema,predicates}.ts`。
- **两档 Model Router**：新增 `createTieredRoutingConfig(provider, defaultModel, cheapModel)` 与 `DEFAULT_PHASE_TIERS` 常量（inputValidation/retrieval → cheap，其余 default）。新增 env `LLM_MODEL_CHEAP`，未设置时回退默认模型。`SearchDeps.evidenceEvalModel` 端到端打通，orchestrator 用 cheap 模型做 evidence eval 与 keyword refine。
- **Anthropic Prompt Caching**：`ChatParams`/`StructuredParams` 新增 `cacheSystem?: boolean`；Claude provider 自动把 system 渲染为 `cache_control: ephemeral` text block。`TokenUsage` 新增可选 `cacheReadInputTokens` / `cacheCreationInputTokens`，按 10% / 125% 倍数计入 `estimatedCostUSD`。synthesize-report 与 cross-validate actor 默认开启。
- **synthesize-report 加固**：硬编码 `maxTokens: 16384` 改为 `getModelMaxOutput(provider, model)` 动态查询（Haiku 8192 不再 400）；每个 dimension 仅展开 top-K=5 证据（按 credibility × recency 排序），其余以 `[n+i] sourceName — url` 形式做引用 tail，bound 提示词 token。
- **evaluateEvidence split-retry**：batch 失败时拆半递归（`processBatch`），单条隔离后才丢弃并 warn。1 条毒数据不再吞掉整批 5 条证据。
- **refineKeywords give-up**：失败时返回 `{ zh: [], en: [] }`，`searchDimension` 检测后 break 当前维度搜索循环；不再用旧关键词空转下一轮。

### Dropped
- **6.5.3 报告生成流式输出**：研究通常耗时 10-60 分钟，用户不会保持前端打开等待；价值不足以抵复杂度成本。

### Added — Sprint B: 可观测性 + CI（6.6.1-6.6.3 / 6.7.1 / 6.7.4 / 6.9.1 / 6.3.5）
- 结构化日志（pino）替换全仓 `console.*`；统一 `{ time, level, module, ... }` 字段。
- 三级 correlation id：API 入口生成 `requestId` (ULID) → 入队带入 job → workflow 内 `{ requestId, jobId, sessionId }` 贯穿全部日志。
- `app.onError` 生成 `errorId` 并返回 `{ error, errorId }`；前端可显示并复制定位。
- API 集成测试：13 个 `research.routes.test.ts` 覆盖 8 端点 happy path / 鉴权 / 404 / SSE catchup / clarification / iterate / cancel。
- 端到端测试：`workflow/__tests__/e2e.test.ts` 用 MockLLM + 内存搜索 provider 跑完整 pipeline，校验持久化与事件序列。
- GitHub Actions CI：`.github/workflows/ci.yml` — Node 22 + `pnpm turbo typecheck test build` + Docker smoke build。
- `loadConfig` worker 启动时一次性加载并缓存到模块级单例，缺 env 启动直接退出。

### Added — Sprint A: 生产堵漏（6.1 / 6.2 / 6.3 核心 / 6.4 / 6.8 核心）
- **安全与鉴权**（6.1）：API 全端点 Bearer Token 鉴权 + session ownership 校验（`owner_token_hash` 列）；CORS 改为 `WEB_ORIGIN` allowlist；IP 60/min + 会话创建 10/h/(IP+token) 限流；输入长度上限 + 控制字符过滤；SSRF 防护（`assertSafePublicUrl` 覆盖 Jina/Firecrawl/Wayback）；prompt injection 缓解（`wrapExternalContent` sentinel + 系统提示安全条款）；非官方 `ANTHROPIC_BASE_URL` 启动 warn。
- **数据一致性**（6.2）：workflow 内部为 assumptions/dimensions/evidence/crossValidations 在生成时分配稳定 ULID；`persistState` 改为 `INSERT ... ON CONFLICT DO UPDATE`（删除"先 delete 后 insert"）；`synthesize-report` 与 `cross-validate` 用真实 dimension.id 索引（不再依赖 Map 顺序）；新增唯一约束 `uq_assumptions_session_order` / `uq_dimensions_session_name` + 索引 `cross_validations(session_id/dimension_id)` / `research_sessions(parent_session_id)`；persist 失败发 SSE error + `updateSessionStatus(failed)`；token usage / search calls / phases 在 persist 起始处先写入。
- **Worker / 队列稳定性**（6.3.1-6.3.3）：clarification handler 单 listener + 统一 cleanup；`extendLock(token, ...)` 缺 token 时硬失败而非空串吞掉；XState subscribe 改为 enter-state 边沿触发避免重入并发；lock 续期 15s 定时器。
- **SSE 可靠性**（6.4）：catchup race 修复（先 subscribe 落 buffer → 读 history → drain 去重 → 切 live）；per-stream 队列化写 + 慢客户端阈值关闭；心跳 `setInterval` 在 stream 关闭时 cleanup；`streamSSE` handler 保留到 abort；subscriber 优雅 `quit`；支持 `Last-Event-ID` / `?lastEventId=` 增量回放；心跳改为 SSE 注释行格式（浏览器 EventSource 不触发 onmessage）。
- **容器化加固**（6.8.1/2/4/5/6/8/9）：优雅关闭 await 进行中请求；Dockerfile `USER node`；compose 移除 `POSTGRES_PASSWORD: prod_secret` 默认值改 `${POSTGRES_PASSWORD:?required}`；Postgres `5432` 不再映射宿主机；`OPENAI_COMPATIBLE_*` env 透传 api/worker；`apps/web/Dockerfile` 移除 `NEXT_PUBLIC_API_URL` 默认值；`apps/api/src/drizzle/index.ts` 缺 `DATABASE_URL` 直接 crash。

### Changed
- `createDefaultRoutingConfig(provider, model)` 保留为向下兼容 shim（内部等价于 `createTieredRoutingConfig(provider, model, model)`）。
- `TokenUsage` 接口新增两个可选字段；老调用方无需变更。

### Migration
- DB schema：`research_sessions.owner_token_hash` 列 + 新唯一索引 / 索引。生产部署需执行一次 `cd apps/api && pnpm db:push`。
- `.env`：必填 `API_AUTH_TOKEN` / `WEB_ORIGIN` / `NEXT_PUBLIC_API_TOKEN`；可选新增 `LLM_MODEL_CHEAP` 启用两档路由。
- `docker-compose.prod.yml`：未设置 `POSTGRES_PASSWORD` / `API_AUTH_TOKEN` / `WEB_ORIGIN` / `NEXT_PUBLIC_API_URL` / `NEXT_PUBLIC_API_TOKEN` 时启动报错。`SHUTDOWN_TIMEOUT_MS` 可选（默认 30000）。
- 宿主机如需直连 Postgres，改用 `docker compose exec postgres psql ...` 或 override 文件加 ports。

---

## [0.5.0] - 2026-05-20

### Added — Phase 5: 优化与扩展
- Model Router 按 Phase 路由到不同模型（`packages/llm/src/router.ts`）
- Token 预算机制（`DEFAULT_TOKEN_BUDGET_USD = 2.0`，超出进入 `budgetExceeded` 终态）
- 搜索结果缓存优化（`RedisContentCache` + `buildCacheKey` 含 provider 参数）
- ETA 事件发射（planning 完成后推送预估剩余时间）
- 迭代研究（Iterate）修复（`deep_dive` + `add_dimension` 完整实现）

---

## [0.4.0] - 2026-05-19

### Added — Phase 4: 前端
- Next.js 14 App Router 应用（`apps/web`）
- 命题输入页面（10-2000 字符验证，中/英语言切换）
- SSE 驱动的实时研究进度面板（6 阶段时间线、维度进度卡片、搜索日志、证据流）
- 报告查看器（react-markdown + remark-gfm、粘性 TOC 导航、评分/结论头部）
- 历史列表（localStorage 持久化、状态筛选）
- 追问弹窗（clarification 事件触发，用户可回复）
- 迭代交互面板（深挖维度 / 新增维度）
- ETA 倒计时、Token 用量统计、连接状态指示器
- shadcn/ui 组件库集成（10 个原子组件）
- Zustand 全局状态管理（research-store + history-store）

---

## [0.3.0] - 2026-05-19

### Added — Phase 3: 分析与报告
- Phase 4 交叉验证 Actor（矛盾检测，4 类矛盾原因分类）
- Phase 5 报告综合 Actor（8 节 Markdown 报告，加权评分 + one-veto）
- 自检工具（4 项强制检查，非 LLM 代码级，最多 1 次重试）
- 新增 API：`GET /report`、`GET /evidence`、`POST /iterate`
- 报告评分机制（0-10 分 5 档，区间分而非精确分）

---

## [0.2.0] - 2026-05-19

### Added — Phase 2: 搜索引擎
- Tavily 搜索 Provider（主力）+ Serper（自动降级备份）
- Jina Reader → Firecrawl → Web Archive 内容提取降级链
- SearchOrchestrator 多轮检索编排（满足度评估、关键词优化）
- Redis 搜索缓存（24h TTL）+ URL 去重
- 并发控制（p-limit: 搜索 3 并发，提取 5 并发，150 calls/session 上限）
- Phase 3 Actor（多维度并行检索）
- SSE 实时进度事件推送

---

## [0.1.0] - 2026-05-18

### Added — Phase 1: 核心骨架
- pnpm monorepo + Turborepo 构建体系
- 4 个 package：`@contritas/shared`、`@contritas/llm`、`@contritas/search`、`@contritas/workflow`
- Hono HTTP 服务 + BullMQ Worker
- PostgreSQL + Drizzle ORM（6 表 schema）
- XState v5 研究状态机
- 多 LLM Provider（Claude + OpenAI Compatible + Mock）
- Phase 0-2 实现（输入验证 → 假设拆解 → 研究规划）
- 基础 API 端点：创建研究、查询状态、SSE 流、取消

# Contritas — 实施路线

> 项目整体进度和各阶段规划。各阶段详细进展见对应的 progress 文档。

---

## 总体进度

| 阶段    | 名称           | 状态      | 详情                                    |
| ------- | -------------- | --------- | --------------------------------------- |
| Phase 1 | 核心骨架       | ✅ 已完成 | [phase1-progress.md](./phase1-progress.md) |
| Phase 2 | 搜索引擎       | ✅ 已完成 | [phase2-progress.md](./phase2-progress.md) |
| Phase 3 | 分析与报告     | ✅ 已完成 | [phase3-progress.md](./phase3-progress.md) |
| Phase 4 | 前端           | ✅ 已完成 | [phase4-progress.md](./phase4-progress.md) |
| Phase 5 | 优化与扩展     | ✅ 已完成 | [phase5-progress.md](./phase5-progress.md) |
| Phase 6 | 加固与生产就绪 | 🚧 进行中 | [phase6-progress.md](./phase6-progress.md) — Sprint A/B/C ✅；CD 前置批 ✅；DX / 测试覆盖批 ✅；**R2 高优批 1 ✅（2026-05-22，6.2.9 + 6.2.10 预算+落盘）**；**R2 高优批 2 ✅（2026-05-22，6.1.8 cross-validate prompt-injection 围栏）**；**R2 高优批 3 ✅（2026-05-22，6.4.8 前端 lastEventId 断点续传）**；R2 剩余：6.1.9 · 6.2.11–13 · 6.3.5 重开 · 6.3.7 · 6.4.9 · 6.5.10 · 6.6.8 · 6.7.7/8 · 6.10.7 · 6.11.1–4；6.6/6.7/6.9/6.10 收尾批 |

---

## 各阶段内容

### Phase 1：核心骨架 ✅

- Monorepo 搭建（pnpm + Turborepo）
- Hono API + BullMQ Worker 基础
- PostgreSQL + Drizzle schema
- 多 LLM Provider 接入（Claude + OpenAI Compatible + 自定义 baseURL）
- Phase 0-2 实现（输入验证 → 假设拆解 → 规划）

### Phase 2：搜索引擎 ✅

- Tavily + Serper 搜索接入
- Jina Reader + Firecrawl + Web Archive 内容提取
- SearchOrchestrator 多轮检索编排
- Redis 缓存 + 速率控制
- Phase 3 实现（多维度并行检索）
- SSE 进度推送

### Phase 3：分析与报告 ✅

- Phase 4 交叉验证实现 ✅
- Phase 5 报告综合生成 ✅
- 评分机制实现 ✅
- 报告模板渲染 ✅
- 自检与回退逻辑 ✅
- 3 个新 API 端点：`/iterate`、`/report`、`/evidence` ✅

### Phase 4：前端 ✅

- Next.js 14 App Router 应用搭建 ✅
- 输入页面 + 实时进度面板（SSE 驱动）✅
- 报告查看器（react-markdown + remark-gfm + TOC 导航）✅
- 历史列表（localStorage 持久化）✅
- 迭代/深挖交互 ✅

### Phase 5：优化与扩展 ✅

- Model Router 按 Phase 路由到不同模型 ✅
- 成本监控与 Token 预算机制 ✅
- 搜索结果缓存优化 ✅
- ETA 事件发射修复 ✅
- 迭代研究（Iterate）功能修复 ✅

### Phase 6：加固与生产就绪 🚧

> 整合 2026-05-20 多维度审视结果。每条子项的文件路径、行号、修复策略、验收标准见 [phase6-progress.md](./phase6-progress.md)。

#### 6.1 安全与鉴权（R2 后：未完）
- [x] API 层认证中间件（Bearer Token），覆盖 `/api/research/*` 全部端点
- [x] Session ownership 校验（`owner_token_hash` 字段 + 非 owner 返回 404）
- [x] CORS 改为基于 `WEB_ORIGIN` 的显式 allowlist
- [x] 请求限流中间件（IP 级 60/min + 会话创建 10/h/IP+token）
- [x] 输入安全校验：`proposition` `max(2000)`、`details` `max(1000)`、`userResponse` `max(2000)`、控制字符过滤
- [x] SSRF 防护：assertSafePublicUrl 覆盖 Jina/Firecrawl/Wayback
- [x] Prompt injection 缓解：`wrapExternalContent` + system prompt 安全条款
- [x] `ANTHROPIC_BASE_URL` 非官方域名时启动 warn 日志
- [x] **R2 6.1.8** cross-validate actor 缺 `wrapExternalContent` + safety clause，存在 prompt-injection 漏洞
- [ ] **R2 6.1.9** `clientIp` 应改为按 `TRUST_PROXY_HOPS` 倒数取，避免云 LB 多跳场景旁路限流

#### 6.2 数据一致性与持久化正确性（R2 后：未完）
- [x] **[Critical]** 修复 `evidence.dimension_id` 与 `dimensions.id` 的 FK 语义：workflow 内部第一次生成实体时即赋稳定 ULID，全链路共享
- [x] **[Critical]** 重构 `persistState`：删除「先 delete 后 insert」改用 `INSERT ... ON CONFLICT DO UPDATE`
- [x] 修复 `synthesize-report.ts` 改用 `dim.id` 直接索引维度（不再依赖 Map 插入顺序）
- [x] `cross-validate.ts` prompt 渲染真实 `id=...`，post-processing 过滤 LLM 幻觉，无返回时退化为该维度全部真实 id
- [x] DB 唯一约束：`uq_assumptions_session_order`、`uq_dimensions_session_name`
- [x] 索引补全：`idx_cross_validations_session/dimension`、`idx_sessions_parent`
- [x] `persistState` 失败发 SSE `error` 事件 + `updateSessionStatus(failed)`
- [x] Token Usage / searchCallsUsed / phases 在 `persistState` 起始处先写入，确保失败也能记录成本
- [x] **R2 6.2.9** Phase 0 validate-input + Phase 3 evaluateEvidence / refineKeywords 的 LLM usage 漏入 tokenUsage（预算守门失效）
- [x] **R2 6.2.10** budget-exceeded 分支 actions 缺 `persistState`，已生成的 assumptions / dimensions 全部丢失
- [ ] **R2 6.2.11** `publishedDate` 是 `text`，rankEvidence 在非 ISO 字符串下 score = NaN，排序不稳
- [ ] **R2 6.2.12** `persistState` 用 `for...of` 顺序 upsert，长 session 持久化耗时高（改批量 + 事务）
- [ ] **R2 6.2.13** `getSessionWithCounts` 串行 4 个 query，被前端 15s 轮询放大；改 `Promise.all` 或单条 join

#### 6.3 Worker 与队列稳定性
- [x] 修复 `handleAwaitingClarification` 的双 message handler + cleanup 不触发缺陷
- [x] `extendLock(job.token ?? "", ...)` 在 token 缺失时硬失败而不是空串吞掉
- [x] XState `actor.subscribe` 改为 enter-state 边沿触发，避免同一 `awaitingClarification` 多次进入引发并发 wait
- [x] BullMQ `attempts: 3` → `1`（短期降级，避免 LLM/搜索重复扣费）；`completed`/`failed` 状态短路；长期 idempotency key 留作后续 ticket
- [ ] **R2 6.3.5（重开）** `loadConfig` 改为模块级单例 `getConfig()`，`middleware/auth.ts` 的 `TOKEN_HASHES` 改 lazy（消除模块加载时副作用）
- [x] Worker / 队列长任务 lock 续期间隔（建议 15s）独立于 clarification 超时
- [ ] Dead-letter queue（failed jobs）的容量监控与告警
- [ ] **R2 6.3.7** DELETE 取消 session 后正在运行的 worker 收不到信号，需 Redis pubsub + actor 间检查点

#### 6.4 SSE 与实时流可靠性（R2 后：未完）
- [x] 修复 SSE catchup race：先订阅落 buffer，再 `getEventHistory`，最后顺序 drain
- [x] SSE 写入加 backpressure：序列化 drain，避免 `await stream.writeSSE` 在慢客户端下乱序/丢失
- [x] 心跳 interval 在 stream 关闭时正确清理（当前依赖 `onAbort`，自然关闭场景可能 leak）
- [x] `Hono streamSSE` 回调改为返回一个 close Promise，保证 handler 不提前 resolve
- [x] `subscriber.disconnect()` 改为 `quit()` 优雅关闭
- [x] `getEventHistory` 支持 `Last-Event-ID` / `?lastEventId=` 增量回放
- [x] 心跳事件改为 SSE 注释行格式（`event: heartbeat` + 空 data，浏览器 EventSource 不触发 onmessage）
- [x] **R2 6.4.8** 客户端 `sse-client.ts` 未保存 `lastEventId` 也不在重连 URL 上传递，服务端断点续传完全没生效
- [ ] **R2 6.4.9** SSE 流关闭用 `setInterval(1s)` 忙等，平均 500ms 延迟；改 `AbortController + addEventListener`

#### 6.5 LLM 可靠性与成本 ✅
- [x] 接入 Anthropic 原生 Structured Output（tool_use + 强制 tool_choice）
- [x] 接入 OpenAI JSON mode（`response_format: json_schema strict`，failure 时回退 non-strict 再回退 prompt）
- [x] 实际启用 Model Router 差异化路由（`LLM_MODEL_CHEAP` env + DEFAULT_PHASE_TIERS：inputValidation/retrieval → cheap，其余 default）
- [x] ~~报告生成流式输出到前端~~（弃案：研究耗时长，用户不会停在前端等）
- [x] 启用 Anthropic prompt caching（synthesize/cross-validate 的 system prompt 标 `cache_control: ephemeral`，TokenUsage 新增 cacheRead/Creation 字段并折算计费）
- [x] `synthesize-report.ts` 的 `maxTokens` 改为 `getModelMaxOutput(provider, model)` 动态查询模型上限
- [x] Synthesize 阶段按 dimension 取 top-K=5（credibility × recency 排序），其余作为引用 tail
- [x] `evaluateEvidence` batch 失败时拆半递归重试，只在单条 batch 失败时才丢并 warn
- [x] `refineKeywords` 失败时返回空数组（caller break 当前维度搜索循环，不再空转）
- [ ] **R2 6.5.10** orchestrator dedup 在 `executeSearches` 已 dedup 的结果上再跑一次 add（no-op，删除以减少误导）

#### 6.6 可观测性
- [x] 结构化日志（pino）替换所有 `console.log/error`，统一字段 + 级别（`apps/api/src/lib/logger.ts`）
- [x] 请求 ID / Job ID / Session ID 三级 correlation id 贯穿 API → Worker → Workflow
- [x] `app.onError` 返回带 errorId 的 5xx，配合日志可定位（`apps/api/src/index.ts:91`）
- [ ] Hono 请求日志中间件 + 慢请求阈值告警
- [ ] 指标采集：job 耗时、token 消耗、搜索调用数、LLM/搜索 retry 率、SSE 重连数、缓存命中率
- [ ] 错误追踪集成（Sentry 或同类）
- [ ] Health check 扩展：BullMQ worker 心跳 + DLQ 大小 + 关键外部 API（Anthropic / Tavily）可达性
- [ ] **R2 6.6.8** `packages/search/src/orchestrator.ts` 残留 3 处 `console.warn / console.debug`，6.6.1 全仓迁移到 pino 时漏改

#### 6.7 测试覆盖
- [x] `apps/api` 集成测试：8 个端点 happy path + 错误场景 + SSE 流 + clarification + iterate + cancel（`apps/api/src/__tests__/research.routes.test.ts`）
- [ ] `packages/workflow` 补充 `validate-input` / `decompose` / `plan` / `search-dimensions` actor 单元测试
- [ ] `apps/web` 关键组件测试：`input-form`、`clarification-dialog`、`iterate-panel`、`sse-client` 重连
- [x] 端到端测试（Mock LLM + Mock Search 跑完整 pipeline，校验持久化与事件序列）（`packages/workflow/src/__tests__/e2e.test.ts`）
- [ ] `synthesize-report.test.ts` 解耦 XState 内部 API（不再使用 `actor.config({input})`）
- [ ] BullMQ retry / lock / clarification 超时的回归测试
- [ ] **R2 6.7.7** 测试覆盖盲点：`apps/api/services/workflow.service.ts` 整文件 / `middleware/rate-limit.ts` 边界 / SSE handler 慢客户端 e2e / `packages/search/extractors/fallback-chain.ts`
- [ ] **R2 6.7.8** 6 个 workflow actor 测试文件各自重复定义 `invokeActor` helper，抽到 `__tests__/utils.ts`

#### 6.8 容器化与部署加固
> 此前误标完成，实际仅完成基础多阶段构建。
- [x] apps/api Dockerfile（多阶段构建）
- [x] apps/web Dockerfile
- [x] docker-compose.prod.yml（含应用服务）
- [x] 健康检查端点（`GET /health`）— 检测 DB + Redis 连通性
- [x] 优雅关闭真正等待进行中连接（当前 `server.close()` 不 await 活跃请求）
- [x] 容器以非 root 用户运行（`USER node` + 文件权限）
- [x] `apps/api/Dockerfile` + `apps/web/Dockerfile` 加 `HEALTHCHECK` 指令（compose 之外也可用）
- [x] `docker-compose.prod.yml` 移除 `POSTGRES_PASSWORD: prod_secret` 默认值，改为 `${POSTGRES_PASSWORD:?required}`
- [x] 生产 compose 不再把 Postgres `5432` 暴露到宿主机
- [x] 生产 compose 透传 `OPENAI_COMPATIBLE_*` 等可选 LLM env 至 api/worker
- [x] 容器启动时自动执行 migration（api entrypoint 跑 `drizzle-orm` migrator；worker 通过 `RUN_MIGRATIONS=false` + `depends_on api healthy` 跳过）
- [x] `apps/web/Dockerfile` 生产阶段的 `NEXT_PUBLIC_API_URL` 默认值移除，强制部署方显式注入
- [x] `apps/api/src/drizzle/index.ts` 默认值改为 fail-fast，禁止在 env 缺失时回落到 dev 凭据

#### 6.9 DX 与工程化
- [x] 新增 CI（GitHub Actions）：PR 上跑 lint + typecheck + test + 构建 + Docker build（`.github/workflows/ci.yml`）
- [ ] 引入 pre-commit hook（husky + lint-staged + prettier --write）
- [x] 全仓 ESLint config + 各 package 补 `lint` 脚本（根 flat config + `apps/web` next lint，`pnpm turbo lint` 全绿）
- [ ] `tsconfig.base.json` 开启 `noUncheckedIndexedAccess`
- [x] 修正 `package.json` 版本与 CHANGELOG 对齐（统一升至 0.6.0，配套 changesets 自动化）
- [x] `scripts/dev.sh` 同时启动 API + Worker + Web（trap 转发信号 + 任一退出整体收摊）
- [x] `.gitignore` 补 `.env.*`（保留 `.env.example` / `.env.*.example`）；`.dockerignore` 同步覆盖
- [x] Release Publishing：`.github/workflows/release.yml` 在 `v*.*.*` tag 触发，`docker buildx --push` 多架构镜像（amd64+arm64）到 `ghcr.io/xgyyx/contritas-{api,web}:<version>` 同时 push `latest`；`scripts/extract-changelog.mjs` 抽 CHANGELOG 段落作 Release notes
- [x] Version 自动化：引入 changesets（`fixed` 共版本，根 CHANGELOG 仍手动维护），PR 必带 changeset，merge 后自动 release PR，merge release PR 推 tag 触发 6.9.8

#### 6.10 文档与一致性
- [x] `CLAUDE.md` 进度区块与本 roadmap 对齐（已在 0.7.1 后逐项 ✅/[ ] 同步）
- [x] `docs/deployment/docker.md` 标注非 root / 健康检查 / migration 等加固步骤
- [ ] `apps/api/README.md` 与 `apps/web/README.md` 同步生产部署要求（api 仅写了 migration，缺 `API_AUTH_TOKEN` / `WEB_ORIGIN` / 非 root；web 完全未提）
- [x] 新增 `docs/security.md`：鉴权模型、CORS、限流、SSRF/prompt-injection 策略
- [x] `docs/architecture/data-model.md` 补充新增唯一约束与索引说明（`uq_assumptions_session_order` / `uq_dimensions_session_name` / `idx_cross_validations_*`）
- [x] 删除审视后已证伪/不准确的说明
- [x] 新增 `docs/deployment/release.md`：CI/CD 全流程 + 「为什么是 classic PAT」诊断（0.7.1 fix 沉淀）
- [ ] **R2 6.10.7** Web Archive extractor 复用 `jinaApiKey` 字段名语义不清，需重命名或加 JSDoc

#### 6.11 前端代码质量与性能（R2 新增 2026-05-22）
- [ ] **6.11.1** ResearchStore 的 `searchLog` / `evidenceFeed` / `errors` 数组无界增长，需 ring buffer 限长
- [ ] **6.11.2** `MarkdownRenderer` 用 inline `components={{...}}` 字面量导致每次重渲染，提到模块顶层或 `useMemo`
- [ ] **6.11.3** `apps/web/src/app/research/[id]/page.tsx` 两处 `setReport(data as any)` 类型逃逸，需 shared 导出 Report 类型 + api-client 加返回类型
- [ ] **6.11.4** `loadInitial` useEffect 把 7 个 zustand setter 列为依赖（全是稳定引用），改 `useShallow` 或 `getState()`

---

## Phase 6 优先级建议

按「不修就不能上线」→「上线后会很痛」→「长期债」排序，建议执行顺序：

1. **6.1 安全与鉴权**（无鉴权 + CORS 全开 = 上线立爆 LLM 账单）
2. **6.2 数据一致性**（dimensionId FK / persistState 重生 ID，影响数据正确性）
3. **6.3 Worker 稳定性**（clarification handler、lock token、subscribe 重入）
4. **6.4 SSE 可靠性**（catchup race + backpressure）
5. **6.8 容器化加固**（非 root + 密码 + 端口暴露 + migration）
6. **6.6 可观测性**（结构化日志 + correlation id + error id，没有它 1-3 上线无从排障）
7. **6.5 LLM 可靠性与成本**（Structured Output + prompt caching 立刻见效）
8. **6.9 DX**（CI 应该尽早加，让后续每个修复都被守住）
9. **6.7 测试覆盖**（与 6.9 配套滚动补）
10. **6.10 文档同步**（每完成一个子项时随手维护）
11. **6.11 前端代码质量与性能**（R2 新增；长 session / 高频更新场景下的稳定性）

### R2 批次优先级（2026-05-22 审视新增 17 项）

1. **6.2.9 / 6.2.10**（🟧 预算守门失效 + 超预算时数据不落盘） — 直接影响成本与用户已付费产出，优先级最高
2. **6.1.8**（🟧 cross-validate prompt-injection 漏洞） — 真实可触发的安全洞，与 6.1.6 整体策略保持一致
3. **6.4.8**（🟧 客户端不带 lastEventId，断点续传形同虚设） — 影响 UX 与服务端压力
4. **6.3.5 重开**（🟨 loadConfig 单例 + auth.ts lazy） — 修文档与实现的偏差，顺带为后续 hot-reload 测试场景铺路
5. 中等：6.3.7 cancel / 6.4.9 SSE 关闭忙等 / 6.2.11–13 数据细节 / 6.6.8 漏 pino / 6.11.x 前端
6. 低：6.1.9 / 6.5.10 / 6.7.7/8 / 6.10.7

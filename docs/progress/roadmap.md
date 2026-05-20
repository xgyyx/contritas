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
| Phase 6 | 加固与生产就绪 | 🚧 进行中 | [phase6-progress.md](./phase6-progress.md) — 6.1 ✅；6.2–6.10 待办 |

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

#### 6.1 安全与鉴权 ✅
- [x] API 层认证中间件（Bearer Token），覆盖 `/api/research/*` 全部端点
- [x] Session ownership 校验（`owner_token_hash` 字段 + 非 owner 返回 404）
- [x] CORS 改为基于 `WEB_ORIGIN` 的显式 allowlist
- [x] 请求限流中间件（IP 级 60/min + 会话创建 10/h/IP+token）
- [x] 输入安全校验：`proposition` `max(2000)`、`details` `max(1000)`、`userResponse` `max(2000)`、控制字符过滤
- [x] SSRF 防护：assertSafePublicUrl 覆盖 Jina/Firecrawl/Wayback
- [x] Prompt injection 缓解：`wrapExternalContent` + system prompt 安全条款
- [x] `ANTHROPIC_BASE_URL` 非官方域名时启动 warn 日志

#### 6.2 数据一致性与持久化正确性
- [ ] **[Critical]** 修复 `evidence.dimension_id` 与 `dimensions.id` 的 FK 语义（workflow 端与 persist 端各自 `generateId()` 导致 FK 永不对齐）
- [ ] **[Critical]** 重构 `persistState`：废弃「先 delete 后 insert + 新 ULID」模式，改用稳定 ID upsert
- [ ] 修复 `synthesize-report.ts` 按 `evidenceByDimension` 插入顺序定位维度的隐式 bug（维度名/证据错位）
- [ ] `cross-validate.ts` 在 LLM 未返回 `evidenceIds` 时停止构造 `${dimensionId}:${i}` 假 ID
- [ ] 增加 DB 唯一约束：`(session_id, order)` 对 assumptions、`(session_id, name)` 对 dimensions
- [ ] 补缺索引：`cross_validations(session_id)`、`cross_validations(dimension_id)`、`research_sessions(parent_session_id)`
- [ ] `persistState` 失败不再静默 `console.error`，需上报指标 + 让作业感知
- [ ] Token Usage 每个 phase 完成后实时更新（非仅 persistState 末尾）

#### 6.3 Worker 与队列稳定性
- [ ] 修复 `handleAwaitingClarification` 的双 message handler + cleanup 不触发缺陷
- [ ] `extendLock(job.token ?? "", ...)` 在 token 缺失时硬失败而不是空串吞掉
- [ ] XState `actor.subscribe` 改为 enter-state 边沿触发，避免同一 `awaitingClarification` 多次进入引发并发 wait
- [ ] BullMQ `attempts: 3` 配套幂等保护（or 暂时降为 1），避免 LLM/搜索重复扣费、SSE 事件重复
- [ ] `loadConfig` 在 worker 启动时一次性加载，去掉 `processResearchJob` 中的 dynamic import
- [ ] Worker / 队列长任务 lock 续期间隔（建议 15s）独立于 clarification 超时
- [ ] Dead-letter queue（failed jobs）的容量监控与告警

#### 6.4 SSE 与实时流可靠性
- [ ] 修复 SSE catchup race：先订阅落 buffer，再 `getEventHistory`，最后顺序 drain
- [ ] SSE 写入加 backpressure：序列化 drain，避免 `await stream.writeSSE` 在慢客户端下乱序/丢失
- [ ] 心跳 interval 在 stream 关闭时正确清理（当前依赖 `onAbort`，自然关闭场景可能 leak）
- [ ] `Hono streamSSE` 回调改为返回一个 close Promise，保证 handler 不提前 resolve
- [ ] `subscriber.disconnect()` 改为 `quit()` 优雅关闭
- [ ] `getEventHistory` 分页 / 截断策略（长会话客户端重连不再拉全量）
- [ ] 心跳事件改为 `: heartbeat\n\n` 注释行格式

#### 6.5 LLM 可靠性与成本
- [ ] 接入 Anthropic 原生 Structured Output（tool_use / JSON mode）
- [ ] 接入 OpenAI JSON mode（`response_format`）
- [ ] 实际启用 Model Router 差异化路由（便宜模型用于 evidence eval，贵模型用于 synthesis）
- [ ] 报告生成流式输出到前端（使用 chatStream）
- [ ] 启用 Anthropic prompt caching（synthesize/cross-validate 的 system prompt + 大上下文块）
- [ ] `synthesize-report.ts` 的 `maxTokens: 16384` 与目标模型上限做兼容检查（Haiku 上限 8192）
- [ ] Synthesize 阶段按 dimension 截断 evidence 至 top-N，避免无上限拼接
- [ ] `evaluateEvidence` batch 失败时改为缩小 batch 重试，而不是整批吞错
- [ ] `refineKeywords` 失败时不再原样返回旧关键词（否则下轮全被去重命中导致空转）

#### 6.6 可观测性
- [ ] 结构化日志（pino 或同等）替换所有 `console.log/error`，统一字段 + 级别
- [ ] 请求 ID / Job ID / Session ID 三级 correlation id 贯穿 API → Worker → Workflow
- [ ] `app.onError` 返回带 error id 的 5xx，配合日志可定位
- [ ] Hono 请求日志中间件 + 慢请求阈值告警
- [ ] 指标采集：job 耗时、token 消耗、搜索调用数、LLM/搜索 retry 率、SSE 重连数、缓存命中率
- [ ] 错误追踪集成（Sentry 或同类）
- [ ] Health check 扩展：BullMQ worker 心跳 + DLQ 大小 + 关键外部 API（Anthropic / Tavily）可达性

#### 6.7 测试覆盖
- [ ] `apps/api` 集成测试：8 个端点 happy path + 错误场景 + SSE 流 + clarification + iterate + cancel
- [ ] `packages/workflow` 补充 `validate-input` / `decompose` / `plan` / `search-dimensions` actor 单元测试
- [ ] `apps/web` 关键组件测试：`input-form`、`clarification-dialog`、`iterate-panel`、`sse-client` 重连
- [ ] 端到端测试（Mock LLM + Mock Search 跑完整 pipeline，校验持久化与事件序列）
- [ ] `synthesize-report.test.ts` 解耦 XState 内部 API（不再使用 `actor.config({input})`）
- [ ] BullMQ retry / lock / clarification 超时的回归测试

#### 6.8 容器化与部署加固
> 此前误标完成，实际仅完成基础多阶段构建。
- [x] apps/api Dockerfile（多阶段构建）
- [x] apps/web Dockerfile
- [x] docker-compose.prod.yml（含应用服务）
- [x] 健康检查端点（`GET /health`）— 检测 DB + Redis 连通性
- [ ] 优雅关闭真正等待进行中连接（当前 `server.close()` 不 await 活跃请求）
- [ ] 容器以非 root 用户运行（`USER node` + 文件权限）
- [ ] `apps/api/Dockerfile` 增加 `HEALTHCHECK` 指令（compose 之外也可用）
- [ ] `docker-compose.prod.yml` 移除 `POSTGRES_PASSWORD: prod_secret` 默认值，改为 `${POSTGRES_PASSWORD:?required}`
- [ ] 生产 compose 不再把 Postgres `5432` 暴露到宿主机
- [ ] 生产 compose 透传 `OPENAI_COMPATIBLE_*` 等可选 LLM env 至 api/worker
- [ ] 容器启动时自动执行 migration（或单独的 migration job）
- [ ] `apps/web/Dockerfile` 生产阶段的 `NEXT_PUBLIC_API_URL` 默认值移除，强制部署方显式注入
- [ ] `apps/api/src/drizzle/index.ts` 默认值改为 fail-fast，禁止在 env 缺失时回落到 dev 凭据

#### 6.9 DX 与工程化
- [ ] 新增 CI（GitHub Actions）：PR 上跑 typecheck + test + 构建 + Docker build
- [ ] 引入 pre-commit hook（husky + lint-staged + prettier --write）
- [ ] 全仓 ESLint config + 各 package 补 `lint` 脚本（让 `pnpm lint` 真的有用）
- [ ] `tsconfig.base.json` 开启 `noUncheckedIndexedAccess`
- [ ] 修正 `package.json` 版本与 CHANGELOG 对齐（当前 0.1.0 vs CHANGELOG 0.5.0）
- [ ] `scripts/dev.sh` 同时启动 API + Worker（当前只启 API）
- [ ] `.gitignore` 补 `.env.local` `.env.production`；`.dockerignore` 覆盖 `.env.*`

#### 6.10 文档与一致性
- [ ] `CLAUDE.md` 进度区块与本 roadmap 对齐（6.5 改为部分完成）
- [ ] `docs/deployment/docker.md` 标注非 root / 健康检查 / migration 等加固步骤
- [ ] `apps/api/README.md` 与 `apps/web/README.md` 同步生产部署要求
- [ ] 新增 `docs/security.md`：鉴权模型、CORS、限流、SSRF/prompt-injection 策略
- [ ] `docs/architecture/data-model.md` 补充新增唯一约束与索引说明
- [ ] 删除审视后已证伪/不准确的说明（如 6.5「优雅关闭增强」原状）

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

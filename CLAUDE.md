# CLAUDE.md

Contritas 是一个结构化尽职调查 Agent —— 接收用户的决策命题，拆解假设，多源检索并交叉验证，输出带置信度的尽调报告。

## 项目结构

pnpm monorepo + Turborepo，4 个 package + 2 个 app：

```
apps/api          — Hono HTTP 服务 (port 4000) + BullMQ Worker
apps/web          — Next.js 14 前端 (port 3000)
packages/shared   — 共享类型、Zod schema、工具函数（@contritas/shared）
packages/llm      — LLM Provider 抽象层 + Prompt（@contritas/llm）
packages/search   — 搜索/内容提取 Provider + 编排器（@contritas/search）
packages/workflow  — XState v5 研究流程状态机（@contritas/workflow）
```

依赖关系：`shared` ← `llm` ← `search` ← `workflow`，`api` 依赖所有四个。

## 常用命令

```bash
# 启动基础设施（PostgreSQL + Redis）
docker compose up -d

# 安装依赖
pnpm install

# 推送数据库 schema
cd apps/api && pnpm db:push

# 启动前端（port 3000）
cd apps/web && pnpm dev

# 启动 API 服务器（port 4000）
cd apps/api && pnpm dev

# 启动 Worker（另一个终端）
cd apps/api && pnpm worker

# 全量测试
pnpm turbo test

# 类型检查
pnpm turbo typecheck

# 数据库迁移
cd apps/api && pnpm db:generate   # 生成迁移
cd apps/api && pnpm db:push       # 推送到 DB
```

## 关键技术选型

- **HTTP**: Hono (TypeScript-first, 内置 SSE)
- **运行时**: Node.js 22+
- **任务队列**: BullMQ + Redis（研究耗时 10-60 分钟，不能绑定 HTTP 请求）
- **工作流**: XState v5 状态机（支持并行、条件转换、序列化恢复）
- **ORM**: Drizzle（零开销，原生 JSONB）
- **校验**: Zod（前后端共享 schema）
- **LLM**: Claude (主力) + OpenAI Compatible（通过 LLM_PROVIDER 环境变量切换）
- **搜索**: Tavily (主) + Serper (备)
- **内容提取**: Jina Reader → Firecrawl → Web Archive（降级链）
- **前端**: Next.js 14 + shadcn/ui + Tailwind CSS + Zustand + react-markdown

## 环境变量

必需：`DATABASE_URL`, `REDIS_URL`, `LLM_PROVIDER`, `ANTHROPIC_API_KEY`（或 `OPENAI_COMPATIBLE_*`），`TAVILY_API_KEY`

前端：`NEXT_PUBLIC_API_URL`（默认 `http://localhost:4000`）

可选：`ANTHROPIC_BASE_URL`, `SERPER_API_KEY`, `JINA_API_KEY`, `FIRECRAWL_API_KEY`, `LLM_MODEL_CHEAP`（Sprint C 两档路由的 cheap 档模型 id；留空时所有 phase 都走默认模型）

完整列表见 `.env.example`。

## Agent 研究流程（6 Phase Pipeline）

```
Phase 0: 输入验证  → packages/workflow/src/actors/validate-input.ts
Phase 1: 假设拆解  → packages/workflow/src/actors/decompose.ts
Phase 2: 研究规划  → packages/workflow/src/actors/plan.ts
Phase 3: 多源检索  → packages/workflow/src/actors/search-dimensions.ts + packages/search/
Phase 4: 交叉验证  → packages/workflow/src/actors/cross-validate.ts
Phase 5: 报告综合  → packages/workflow/src/actors/synthesize-report.ts + packages/workflow/src/utils/self-check.ts
```

状态机定义：`packages/workflow/src/machine.ts`

## 数据库

PostgreSQL，6 张表：`research_sessions`, `assumptions`, `dimensions`, `evidence`, `cross_validations`, `reports`。

Schema 定义：`apps/api/src/drizzle/schema.ts`（Drizzle 格式，以代码为准）。

## API 端点

已实现：
- `GET /health` — 健康检查（检测 DB + Redis 连通性）
- `POST /api/research` — 创建研究会话（返回 202）
- `GET /api/research/:id` — 获取会话状态
- `GET /api/research/:id/stream` — SSE 实时进度
- `GET /api/research/:id/report` — 获取生成的报告
- `GET /api/research/:id/evidence` — 获取所有证据
- `POST /api/research/:id/respond` — 用户回复追问
- `POST /api/research/:id/iterate` — 迭代研究（深挖/新增维度）
- `DELETE /api/research/:id` — 取消研究

路由定义：`apps/api/src/routes/research.ts`

## 开发进度

- Phase 1 核心骨架 ✅
- Phase 2 搜索引擎 ✅
- Phase 3 分析与报告 ✅（交叉验证 + 报告综合 + 评分 + 自检）
- Phase 4 前端 ✅（Next.js + SSE 实时 + 报告查看 + 历史 + 迭代交互）
- Phase 5 优化与扩展 ✅（ModelRouter 路由 + Token 预算 + 搜索缓存优化 + ETA 事件 + 迭代修复）
- Phase 6 加固与生产就绪 🚧（10 个子领域：6.1 安全鉴权 ✅ / 6.2 数据一致性 ✅ / 6.3 Worker 稳定性（核心 clarification 三项 ✅；loadConfig 单例 / DLQ 监控待办）/ 6.4 SSE 可靠性 ✅ / 6.5 LLM 可靠性与成本 ✅（两档路由 + tool_use / json_schema + prompt caching + Top-K + split-retry；6.5.3 流式输出已弃）/ 6.6 可观测性（pino + 三级 correlation id + errorId ✅；请求日志 / metrics / Sentry / health 扩展待办）/ 6.7 测试覆盖 ✅（API 集成 + e2e + 4 个 workflow actor 单测 + BullMQ clarification 回归 + apps/web 4 组件 RTL 测试，共 166 测试）/ 6.8 容器化加固 ✅（HEALTHCHECK + auto-migration 已在 0.7.0 完成）/ 6.9 DX 工程化（CI + changesets + GHCR release + ESLint flat config + dev.sh 并行 + ignore 已就位 ✅；pre-commit / noUncheckedIndexedAccess 待办）/ 6.10 文档同步（security.md / docker.md 加固 / data-model 索引说明 ✅；CLAUDE.md 与各 README 持续同步中））

总体规划详见 `docs/progress/roadmap.md`，工单级执行手册详见 `docs/progress/phase6-progress.md`。

## 文档索引

- 产品需求：`docs/prd/prd.md`
- 报告模板：`docs/prd/report-template.md`
- Agent 行为规范（评分/降级/约束）：`docs/guides/agent-behavior.md`
- 架构总览：`docs/architecture/overview.md`
- 工作流引擎：`docs/architecture/workflow-engine.md`
- LLM 层：`docs/architecture/llm-layer.md`
- 搜索层：`docs/architecture/search-layer.md`
- 数据模型：`docs/architecture/data-model.md`
- 基础设施：`docs/architecture/realtime-and-infra.md`
- Docker 部署：`docs/deployment/docker.md`
- 发布流程 (CI/CD + changesets + GHCR)：`docs/deployment/release.md`
- 安全策略（鉴权 / CORS / 限流 / SSRF / Prompt Injection）：`docs/security.md`
- PRD 映射表：`docs/prd-mapping.md`
- Phase 6 工单手册：`docs/progress/phase6-progress.md`

## 编码约定

- TypeScript strict mode，ESM（`"type": "module"`）
- 实体 ID 使用 ULID（`packages/shared/src/utils/id.ts`）
- 所有 API 请求/响应通过 Zod schema 校验（`packages/shared/src/utils/validation.ts`）
- 测试框架 Vitest，测试文件放在各 package 的 `__tests__/` 目录

# @contritas/api

Hono HTTP 服务 + BullMQ Worker，提供研究会话管理 API 和后台任务处理。

## 启动

```bash
# API 服务器 (port 4000)
pnpm dev

# Worker（另一个终端）
pnpm worker
```

## API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/research` | 创建研究会话（返回 202） |
| `GET` | `/api/research/:id` | 获取会话状态 |
| `GET` | `/api/research/:id/stream` | SSE 实时进度 |
| `GET` | `/api/research/:id/report` | 获取生成的报告 |
| `GET` | `/api/research/:id/evidence` | 获取所有证据 |
| `POST` | `/api/research/:id/respond` | 用户回复追问 |
| `POST` | `/api/research/:id/iterate` | 迭代研究（深挖/新增维度） |
| `DELETE` | `/api/research/:id` | 取消研究 |

## 架构

```
src/
├── index.ts          # Hono app 入口
├── worker.ts         # BullMQ Worker 入口
├── config.ts         # 环境变量加载与校验
├── routes/
│   └── research.ts   # 路由定义
├── services/         # 业务逻辑层（session、stream、workflow）
├── jobs/
│   └── research.job.ts  # BullMQ 作业处理
├── lib/              # Redis 连接、队列配置
└── drizzle/
    └── schema.ts     # 数据库 Schema（6 张表）
```

## 数据库

PostgreSQL，通过 Drizzle ORM 管理。Schema 定义在 `src/drizzle/schema.ts`，迁移 SQL 在 `src/drizzle/migrations/`。

```bash
pnpm db:generate   # schema 变更后生成新迁移文件（commit 进仓库）
pnpm db:push       # 仅本地开发：直接推 schema，不生成迁移文件
pnpm db:migrate    # 显式应用 migrations/ 下未执行的迁移
```

**生产容器**：API 容器启动时 `docker-entrypoint.sh` 会自动跑 `node dist/scripts/migrate.js`，把迁移落到 DB 后再 exec CMD。设 `RUN_MIGRATIONS=false` 可跳过（compose 中 worker 服务即如此，避免双跑争 advisory lock）。

## 环境变量

必需：`DATABASE_URL`、`REDIS_URL`、`LLM_PROVIDER`、`ANTHROPIC_API_KEY`、`TAVILY_API_KEY`

完整列表见根目录 `.env.example`。

## 开发

```bash
pnpm typecheck
pnpm test
```

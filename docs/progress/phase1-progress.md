# Phase 1 实施进度

> 核心骨架搭建

## 状态总览

| Chunk | 名称                            | 状态    | 完成日期   |
| ----- | ------------------------------- | ------- | ---------- |
| 1     | Monorepo 脚手架                 | ✅ 完成 | 2026-05-18 |
| 2     | Docker Compose + Drizzle Schema | ✅ 完成 | 2026-05-18 |
| 3     | 共享类型与校验 Schema           | ✅ 完成 | 2026-05-18 |
| 4     | LLM 抽象层（Claude Provider）   | ✅ 完成 | 2026-05-18 |
| 5     | XState 工作流（Phase 0-2）      | ✅ 完成 | 2026-05-18 |
| 6     | Hono API 服务器                 | ✅ 完成 | 2026-05-18 |
| 7     | BullMQ Worker + 工作流集成      | ✅ 完成 | 2026-05-18 |
| 8     | 测试 + 脚本 + 进度文档          | ✅ 完成 | 2026-05-18 |

## 测试结果

- `packages/shared`: 11 tests passed
- `packages/llm`: 8 tests passed
- `packages/workflow`: 5 tests passed
- 总计: 24 tests passed

## 项目结构

```
contritas/
├── package.json                     # pnpm workspace root
├── pnpm-workspace.yaml
├── turbo.json
├── tsconfig.base.json
├── .env.example
├── .gitignore
├── docker-compose.yml
│
├── apps/
│   ├── api/                         # Hono API + BullMQ Worker
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── vitest.config.ts
│   │   ├── drizzle.config.ts
│   │   └── src/
│   │       ├── index.ts             # Hono app 入口 (port 4000)
│   │       ├── worker.ts            # BullMQ worker 入口
│   │       ├── config.ts            # 环境变量加载
│   │       ├── drizzle/
│   │       │   ├── schema.ts        # 6 张表定义
│   │       │   └── index.ts         # DB 连接
│   │       ├── lib/
│   │       │   ├── redis.ts         # Redis 连接
│   │       │   └── queue.ts         # BullMQ Queue
│   │       ├── routes/
│   │       │   └── research.ts      # 5 个 API 端点
│   │       ├── services/
│   │       │   ├── session.service.ts
│   │       │   ├── stream.service.ts
│   │       │   └── workflow.service.ts
│   │       └── jobs/
│   │           └── research.job.ts
│   │
│   └── web/                         # 占位（Phase 4）
│       └── package.json
│
├── packages/
│   ├── shared/                      # 共享类型和工具
│   │   └── src/
│   │       ├── index.ts
│   │       ├── constants.ts
│   │       ├── types/
│   │       │   ├── entities.ts
│   │       │   ├── events.ts
│   │       │   └── api.ts
│   │       ├── utils/
│   │       │   ├── validation.ts    # Zod schemas
│   │       │   └── id.ts            # ULID 生成
│   │       └── __tests__/
│   │           └── validation.test.ts
│   │
│   ├── workflow/                     # XState 状态机
│   │   └── src/
│   │       ├── index.ts
│   │       ├── types.ts
│   │       ├── machine.ts           # 主状态机
│   │       ├── guards.ts
│   │       ├── actors/
│   │       │   ├── validate-input.ts
│   │       │   ├── decompose.ts
│   │       │   └── plan.ts
│   │       └── __tests__/
│   │           └── machine.test.ts
│   │
│   ├── llm/                         # LLM 抽象层
│   │   └── src/
│   │       ├── index.ts
│   │       ├── types.ts
│   │       ├── factory.ts
│   │       ├── router.ts
│   │       ├── providers/
│   │       │   ├── claude.ts
│   │       │   └── mock.ts
│   │       ├── prompts/
│   │       │   ├── phase0-validate.ts
│   │       │   ├── phase1-decompose.ts
│   │       │   └── phase2-plan.ts
│   │       └── __tests__/
│   │           └── mock-provider.test.ts
│   │
│   └── search/                      # 占位（Phase 2）
│       └── src/index.ts
│
├── scripts/
│   ├── dev.sh
│   └── db-migrate.sh
│
└── docs/
    ├── prd/prd.md
    ├── architecture/technical-design.md
    └── progress/phase1-progress.md   # 本文档
```

## 如何运行

### 启动开发环境

```bash
# 1. 启动基础设施
docker compose up -d

# 2. 推送数据库 schema
cd apps/api && pnpm db:push

# 3. 设置环境变量
cp .env.example .env
# 编辑 .env，填入真实 ANTHROPIC_API_KEY

# 4. 启动 API 服务器
cd apps/api && pnpm dev

# 5. 启动 Worker（另一个终端）
cd apps/api && pnpm worker
```

### 运行测试

```bash
pnpm turbo test
```

### Typecheck

```bash
pnpm turbo typecheck
```

## 下一步：Phase 2

Phase 2 将实现：

- Tavily 搜索接入
- Jina Reader 内容提取
- Search Orchestrator 多轮检索
- Phase 3（多维度并行检索）
- Redis + SSE 进度推送完善

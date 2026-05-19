# Contritas

> 通过反证逼近真相的通用深度研究 Agent。

Contritas 是一个**结构化尽职调查 Agent**。它接收用户提出的决策命题（商业方案、技术决策、政策判断、投资论点等），将其拆解为可验证的核心假设，通过多源检索和交叉验证，输出带置信度标注的专业尽调报告。

**一句话定义**：不证明你是对的，证明你经得起尽调。

## 目标用户

独立创业者、小团队负责人、早期投资人——他们面临真实的决策风险，但请不起专业尽调团队。

## 核心原则

1. **审计口径，非鼓励口径** — 不迎合用户预期，不只找支持性证据
2. **反证优先** — 每个假设先问"如果它不成立，会因为什么"
3. **证据分级** — 区分高可信来源与弱证据，标注置信度
4. **结论先行** — 报告开头给判断，读者无需通读全文即可获得核心结论
5. **深度优先于广度** — 资源受限时，优先保证高权重维度的证据深度

## 技术栈

| 层级 | 技术 |
|------|------|
| Monorepo | pnpm + Turborepo |
| API | Hono (TypeScript) |
| 工作流引擎 | XState v5 |
| 任务队列 | BullMQ + Redis |
| 数据库 | PostgreSQL + Drizzle ORM |
| LLM | Claude (主力), 支持多模型路由 |
| 搜索 | Tavily / Jina Reader |
| 前端 | Next.js 14 + shadcn/ui + Tailwind CSS |

## 项目结构

```
contritas/
├── apps/
│   ├── api/              # Hono API + BullMQ Worker
│   └── web/              # Next.js 前端
├── packages/
│   ├── shared/           # 共享类型、Zod schemas、工具函数
│   ├── llm/              # LLM 抽象层 (providers + prompts)
│   ├── workflow/          # XState 状态机 (研究流程)
│   └── search/           # 搜索抽象层 (Tavily/Serper + Jina/Firecrawl)
├── docker-compose.yml    # PostgreSQL + Redis
├── turbo.json
└── pnpm-workspace.yaml
```

## 快速开始

### 前置条件

- Node.js >= 22
- pnpm >= 9
- Docker & Docker Compose

### 安装与运行

```bash
# 1. 安装依赖
pnpm install

# 2. 启动基础设施
docker compose up -d

# 3. 配置环境变量
cp .env.example .env
# 编辑 .env，填入 ANTHROPIC_API_KEY 和 TAVILY_API_KEY

# 4. 推送数据库 schema
cd apps/api && pnpm db:push

# 5. 启动前端（port 3000）
cd apps/web && pnpm dev

# 6. 启动 API 服务器（port 4000，另一个终端）
cd apps/api && pnpm dev

# 7. 启动 Worker（另一个终端）
cd apps/api && pnpm worker
```

### 运行测试

```bash
pnpm turbo test
```

### 类型检查

```bash
pnpm turbo typecheck
```

## 研究流程 (6 Phase Pipeline)

```
Phase 0: 验证输入 → 确认命题可调查
Phase 1: 拆解假设 → 提取核心假设 + 权重
Phase 2: 制定计划 → 为每个假设规划搜索策略
Phase 3: 多源检索 → 并行搜索 + 内容提取
Phase 4: 交叉验证 → 证据分级 + 置信度评分
Phase 5: 综合报告 → 生成结构化尽调报告
```

## 开发进度

- [x] Phase 1: 核心骨架搭建 (Monorepo + DB + LLM + Workflow + API)
- [x] Phase 2: 搜索能力接入 (Tavily + Jina Reader + Search Orchestrator)
- [x] Phase 3: 完整研究流程 (交叉验证 + 报告综合 + 评分 + 自检)
- [x] Phase 4: Web 前端 (Next.js + SSE 实时进度 + 报告查看 + 迭代交互)
- [ ] Phase 5: 优化与上线

## 文档

| 文档 | 说明 |
|------|------|
| [PRD](docs/prd/prd.md) | 产品需求：定位、用户故事、功能列表、非功能需求 |
| [报告模板](docs/prd/report-template.md) | Agent 输出报告的标准格式 |
| [Agent 行为规范](docs/guides/agent-behavior.md) | 评分、降级、交互、约束等运行时规则 |
| [架构总览](docs/architecture/overview.md) | 系统架构图、选型决策、项目结构 |
| [工作流引擎](docs/architecture/workflow-engine.md) | XState 状态机、重试、持久化 |
| [LLM 层](docs/architecture/llm-layer.md) | Provider 接口、Model Router |
| [搜索层](docs/architecture/search-layer.md) | 搜索/提取 Provider、编排器 |
| [数据模型](docs/architecture/data-model.md) | 实体关系、PostgreSQL Schema |
| [基础设施](docs/architecture/realtime-and-infra.md) | SSE、存储、部署、安全 |
| [实施路线](docs/progress/roadmap.md) | 各阶段规划与进度 |
| [PRD 映射表](docs/prd-mapping.md) | PRD 需求 → 技术实现追踪 |

## License

MIT

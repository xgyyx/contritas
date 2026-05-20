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
| Phase 6 | 加固与生产就绪 | 🚧 进行中 | 见下方详细清单                              |

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

#### 6.1 安全与鉴权
- [ ] API 层认证中间件（Session Token 或 API Key）
- [ ] Session ownership 校验（用户只能操作自己的 session）
- [ ] 请求限流中间件（rate-limiting，防止滥用）
- [ ] 输入安全校验（originalText 长度上限、控制字符过滤、注入缓解）

#### 6.2 LLM 可靠性
- [ ] 接入 Anthropic 原生 Structured Output（tool_use / JSON mode）
- [ ] 接入 OpenAI JSON mode（response_format）
- [ ] 实际启用 Model Router 差异化路由（便宜模型用于 evidence eval，贵模型用于 synthesis）
- [ ] 报告生成流式输出到前端（使用 chatStream）

#### 6.3 测试覆盖
- [ ] apps/api 集成测试（核心 8 个端点 + SSE 流 + 错误场景）
- [ ] packages/workflow 补充 validate-input / decompose / plan / search-dimensions actor 单元测试
- [ ] apps/web 组件测试（关键交互：input-form、clarification-dialog、iterate-panel）
- [ ] 端到端测试（Mock LLM + Mock Search 的完整 pipeline 跑通）

#### 6.4 可观测性
- [ ] 错误追踪集成（Sentry 或同类服务）
- [ ] 指标采集（job 耗时、token 消耗、搜索调用数、成功/失败率）
- [ ] Dead-letter queue 检查与告警
- [ ] 结构化日志（替换 console.log/error）

#### 6.5 部署与容器化 ✅
- [x] apps/api Dockerfile（多阶段构建）
- [x] apps/web Dockerfile
- [x] docker-compose.prod.yml（含应用服务）
- [x] 健康检查端点（`GET /health`）— 检测 DB + Redis 连通性
- [x] 优雅关闭增强（等待进行中 job 完成或挂起）

#### 6.6 数据一致性
- [ ] 修复 evidence.dimensionId FK 语义（当前 evidence 的 dimensionId 与 dimensions 表 id 不对应）
- [ ] 增加 DB 唯一约束防止数据重复（session+order 对 assumptions，session+name 对 dimensions）
- [ ] 完善 Token Usage 上报（每个 phase 完成后实时更新，非仅 persistState 末尾）

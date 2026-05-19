# Contritas — 实施路线

> 项目整体进度和各阶段规划。各阶段详细进展见对应的 progress 文档。

---

## 总体进度

| 阶段    | 名称           | 状态      | 详情                                    |
| ------- | -------------- | --------- | --------------------------------------- |
| Phase 1 | 核心骨架       | ✅ 已完成 | [phase1-progress.md](./phase1-progress.md) |
| Phase 2 | 搜索引擎       | ✅ 已完成 | [phase2-progress.md](./phase2-progress.md) |
| Phase 3 | 分析与报告     | 🔲 待开始 | —                                       |
| Phase 4 | 前端           | 🔲 待开始 | —                                       |
| Phase 5 | 优化与扩展     | 🔲 待开始 | —                                       |

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

### Phase 3：分析与报告

- Phase 4 交叉验证实现
- Phase 5 报告综合生成
- 评分机制实现
- 报告模板渲染
- 自检与回退逻辑
- 3 个新 API 端点：`/iterate`、`/report`、`/evidence`

### Phase 4：前端

- Next.js 应用搭建
- 输入页面 + 进度面板
- 报告查看器（Markdown 渲染 + 目录导航）
- 历史列表
- 迭代/深挖交互

### Phase 5：优化与扩展

- Model Router 按 Phase 路由到不同模型
- 成本监控与 Token 预算机制
- 搜索结果缓存优化
- 更多 Provider 扩展（如需）

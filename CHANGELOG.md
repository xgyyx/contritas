# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 格式。

## [Unreleased]

### Planned
- Phase 5: Model Router 按 Phase 路由到不同模型
- Phase 5: 成本监控与 Token 预算机制
- Phase 5: 搜索结果缓存优化

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

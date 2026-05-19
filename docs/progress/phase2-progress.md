# Phase 2 实施进度

> 搜索引擎层

## 状态总览

| Chunk | 名称                                | 状态    | 完成日期   |
| ----- | ----------------------------------- | ------- | ---------- |
| 1     | Search Package 类型和接口           | ✅ 完成 | 2026-05-19 |
| 2     | 搜索 Provider（Tavily + Serper）    | ✅ 完成 | 2026-05-19 |
| 3     | 内容提取器（Jina + Firecrawl + WA） | ✅ 完成 | 2026-05-19 |
| 4     | Redis 缓存 + 速率控制               | ✅ 完成 | 2026-05-19 |
| 5     | LLM Prompt（证据评估 + 关键词精炼） | ✅ 完成 | 2026-05-19 |
| 6     | SearchOrchestrator 核心类           | ✅ 完成 | 2026-05-19 |
| 7     | XState 状态机扩展                   | ✅ 完成 | 2026-05-19 |
| 8     | API 层接线 + 配置 + 持久化          | ✅ 完成 | 2026-05-19 |

## 新增文件

```
packages/search/src/
├── types.ts                      # 核心接口定义
├── index.ts                      # 统一导出
├── cache.ts                      # RedisSearchCache
├── rate-limiter.ts               # p-limit + SessionCallCounter
├── deduplicator.ts               # URL 规范化去重
├── orchestrator.ts               # SearchOrchestrator 多轮搜索编排
├── providers/
│   ├── index.ts
│   ├── tavily.ts                 # Tavily 搜索 Provider
│   └── serper.ts                 # Serper 搜索 Provider（备用）
├── extractors/
│   ├── index.ts
│   ├── jina.ts                   # Jina Reader 内容提取
│   ├── firecrawl.ts              # Firecrawl 内容提取（备用）
│   ├── web-archive.ts            # Web Archive 提取（最终回退）
│   └── fallback-chain.ts         # 有序降级链
└── __tests__/
    ├── providers.test.ts
    ├── extractors.test.ts
    └── cache.test.ts

packages/llm/src/prompts/
├── phase3-extract.ts             # 证据评估 Prompt + Schema
└── phase3-refine-keywords.ts     # 关键词精炼 Prompt + Schema

packages/workflow/src/actors/
└── search-dimensions.ts          # XState retrieval actor
```

## 修改文件

- `packages/workflow/src/machine.ts` — `retrievalPending` → 真实 `retrieval` 状态
- `packages/workflow/src/types.ts` — 新增 SearchDeps, EvidenceData, RetrievalResult
- `packages/workflow/src/actors/index.ts` — 导出 searchDimensions
- `packages/workflow/package.json` — 添加 @contritas/search 依赖
- `packages/llm/src/index.ts` — 导出 Phase 3 prompts
- `apps/api/src/config.ts` — 新增 SearchConfig
- `apps/api/src/services/workflow.service.ts` — buildSearchDeps, 新事件类型, evidence 持久化
- `apps/api/src/services/session.service.ts` — 新增 updateSearchCallsUsed
- `apps/api/src/jobs/research.job.ts` — 注入 searchDeps, 终态映射更新
- `apps/api/package.json` — 添加 @contritas/search 依赖
- `.env.example` — 新增 4 个搜索相关 env
- `turbo.json` — globalEnv 追加搜索 env

## 环境变量

```bash
TAVILY_API_KEY=tvly-xxx       # 至少需要一个搜索 provider
SERPER_API_KEY=xxx            # 可选
JINA_API_KEY=jina_xxx         # 可选
FIRECRAWL_API_KEY=fc-xxx      # 可选
```

## 下一步：Phase 3

Phase 3 将实现：

- Agent Phase 4: 交叉验证 + 矛盾检测
- Agent Phase 5: 报告综合 + 评分 + 自检
- 完整报告模板渲染
- 3 个新 API 端点：/iterate, /report, /evidence

# @contritas/search

搜索与内容提取层，提供多源检索能力和智能编排。

## 组件

### 搜索 Provider

| Provider | 说明 |
|----------|------|
| `TavilySearchProvider` | Tavily API（主力搜索） |
| `SerperSearchProvider` | Serper API（自动降级备份） |

### 内容提取器

按优先级降级：

```
JinaExtractor → FirecrawlExtractor → WebArchiveExtractor → skip+log
```

`FallbackExtractorChain` 自动管理降级逻辑。

### 编排器

| 组件 | 说明 |
|------|------|
| `SearchOrchestrator` | 多轮检索编排（满足度评估、关键词优化、证据收集） |
| `RedisSearchCache` | Redis 搜索缓存（24h TTL） |
| `SessionCallCounter` | 会话级调用计数（150 calls 上限） |
| `URLDeduplicator` | URL 去重 |
| `createSearchLimiter` | 搜索并发限制（p-limit 3） |
| `createExtractLimiter` | 提取并发限制（p-limit 5） |

## 使用

```typescript
import { SearchOrchestrator, TavilySearchProvider, FallbackExtractorChain } from "@contritas/search";

const orchestrator = new SearchOrchestrator({
  searchProvider,
  extractorChain,
  cache,
  callCounter,
  deduplicator,
});

const results = await orchestrator.searchDimension(dimension, options);
```

## 环境变量

- `TAVILY_API_KEY`（必需）
- `SERPER_API_KEY`（可选，启用降级）
- `JINA_API_KEY`（可选）
- `FIRECRAWL_API_KEY`（可选）
- `REDIS_URL`（缓存）

## 开发

```bash
pnpm typecheck
pnpm test
```

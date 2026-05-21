# 搜索与内容提取层

> 多 Provider 搜索 + 多提取器降级 + 多轮检索编排。
>
> 相关文档：[架构总览](./overview.md) | 代码：`packages/search/`

---

## 一、搜索 Provider

| Provider         | 定位              | 特点                                                                  |
| ---------------- | ----------------- | --------------------------------------------------------------------- |
| **Tavily**（主） | AI Agent 专用搜索 | 结构化结果、内容摘要、中英文支持、`search_depth: "advanced"` 可读页面 |
| **Serper**（备） | Google SERP 数据  | 速度快、便宜、某些中文查询更优                                        |

搜索失败时自动降级：Tavily → Serper。

---

## 二、内容提取器

| Extractor                   | 定位     | 特点                                                            |
| --------------------------- | -------- | --------------------------------------------------------------- |
| **Jina Reader**（主）       | 轻量提取 | URL 前加 `https://r.jina.ai/` 即可、返回 Markdown、处理 JS 页面 |
| **Firecrawl**（备）         | 重型提取 | 更强的反爬、JS 渲染、复杂页面                                   |
| **Web Archive**（最终回退） | 缓存版本 | 页面不可达时尝试历史快照                                        |

降级链：Jina → Firecrawl → Web Archive → 跳过并记录。实现见 `packages/search/src/extractors/fallback-chain.ts`。

---

## 三、搜索编排器（SearchOrchestrator）

每个维度的多轮搜索流程：

1. 用当前轮关键词搜索（中英文各一组）
2. 提取页面内容
3. LLM 评估证据质量和相关性
4. 判断是否满足要求（≥ 3 独立来源 + ≥ 2 高可信）
5. 未满足 → 基于已有结果调整关键词，进入下一轮
6. 每个维度最多 5 轮

满足性判断标准：
- 最低门槛：3 个独立来源 + 2 个高可信来源
- 目标：5 个独立来源 + 2+ 高可信来源

核心实现见 `packages/search/src/orchestrator.ts`。

### 3.1 LLM 调用使用 cheap-tier 模型（Sprint C / 6.5.2）

`evaluateEvidence` 与 `refineKeywords` 都跑 `SearchDeps.evidenceEvalModel`（由 workflow 端从两档路由的 cheap 槽位注入；未配置 `LLM_MODEL_CHEAP` 时回退到默认模型）。这是 Phase 3 成本控制的主战场——单维度 5 轮 × 多批 evidence eval，全用 Haiku 一类的便宜模型。

### 3.2 失败处理（Sprint C / 6.5.7 / 6.5.8）

- **`evaluateEvidence` split-retry**：batch 整体失败（LLM 报错 / Zod 校验失败）时不再静默丢整批，改为拆半递归（`processBatch`）；只有当 batch 降到 1 条仍失败时，才以 `[evaluateEvidence] dropping single content ...` warn 丢弃单条。1 条毒数据从 5 条 batch 隔离最差需 7 次 LLM call，可接受。
- **`refineKeywords` give-up**：失败时返回 `{ zh: [], en: [] }`（旧行为是返回 dimension.keywords 原值，被去重后下一轮 0 query 空转）。`searchDimension` round 循环检测到全空时 `break`——维度提前以"证据不足"结束，比浪费一轮 LLM call 更经济。

---

## 四、速率控制

| 参数             | 值           | 说明                         |
| ---------------- | ------------ | ---------------------------- |
| 并发搜索         | `p-limit(3)` | 最多 3 个并发搜索请求        |
| 并发提取         | `p-limit(5)` | 最多 5 个并发页面提取        |
| 单会话搜索上限   | 150 次       | 通过 `searchCallsUsed` 追踪  |
| 搜索结果缓存     | 24 小时      | Redis，同查询不重复请求      |

实现见 `packages/search/src/rate-limiter.ts` 和 `packages/search/src/cache.ts`。

---

## 五、URL 去重

搜索结果中的 URL 经过规范化后去重，避免同一页面被重复提取和评估。

实现见 `packages/search/src/deduplicator.ts`。

---

## 五·B、URL 安全（SSRF 防护，Phase 6.1.5）

所有 extractor（`JinaExtractor` / `FirecrawlExtractor` / `WebArchiveExtractor`）在调用前都过 `assertSafePublicUrl(url)`：

- 协议必须 `http(s)`。
- 拒绝带凭据（`user:pass@host`）的 URL。
- DNS 解析后逐 IP 检查，拒绝私网 / 回环 / link-local（含 `169.254.169.254` 云元数据）/ 多播 / 已知 metadata 域名。
- 失败抛 `UnsafeUrlError`，调用方降级为"跳过该 URL"，不会让整个维度失败。

实现：`packages/search/src/utils/url-safety.ts`。

---

## 六、环境变量

```bash
TAVILY_API_KEY=tvly-xxx       # 至少需要一个搜索 provider
SERPER_API_KEY=xxx            # 可选
JINA_API_KEY=jina_xxx         # 可选（无 key 也可用，但有限流）
FIRECRAWL_API_KEY=fc-xxx      # 可选
```

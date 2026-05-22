# 搜索降级链与"接受部分缺失"的工程纪律

> 本系列前几篇：
> 1. [《我做了一个会跟你唱反调的 AI 尽调 Agent——聊聊 Contritas 的架构与选型》](./01-architecture-and-stack.md)
> 2. [《怎么让 LLM 跟你唱反调——Contritas 是怎么把"反驳"写进 Prompt 的》](./02-anti-flattery-prompt-design.md)
> 3. [《Phase 4 交叉验证：让 LLM 找证据矛盾》](./03-phase4-cross-validation.md)
> 4. [《如果你能用 Claude Code，为什么还要 Contritas？》](./04-vs-general-agent.md)

---

## 一、AI 应用最容易翻车的地方，不是 LLM

写一个调研类 Agent，新手最容易把所有注意力放在 prompt 和模型选择上。但实际跑起来，最常翻车的环节是这个：

```
用户提交命题 → LLM 拆假设 → LLM 想搜索词
  → 调 Tavily → 拿回 10 条 URL → 调 Jina 抓全文
    → 抓到 6 篇 → LLM 评估 → 入库
```

看起来很顺。等真跑十次八次，你就会发现这条链的三分之二都不可靠：

- Tavily 偶尔会抽风返回空结果（不是 404，就是空）
- Jina 抓不到 JS-heavy 的页面（很多公司官网、SPA、新版 SaaS）
- 遇到付费墙、反爬、地区限制、临时 503，单次抓取失败率轻松上 30%
- 国内站点的全文抓取尤其难——微信公众号、知乎专栏、内容平台几乎全要降级

**这个时候 LLM 能力再强都没用——你给它一篇都没抓到的 URL 列表，它要么编结论，要么道歉**。第二种情况好，第一种情况是真灾难。

所以做 AI 调研应用，**真正吃工程细节的是这条链**，不是 prompt。这篇就讲 Contritas 是怎么处理这条链的，以及一个比技术更重要的产品纪律：**"宁可少证一条，不可错证一条"**。

---

## 二、为什么不只用一家搜索 + 一家抓取？

直觉答案是"加冗余"，但加冗余有两种加法：

```
A. 并行：两家同时调，谁先回结果用谁
B. 降级：先调主，失败/不达标再调备
```

并行听着好——快、抗抖。但对调研类应用是错的，原因有两个：

1. **成本翻倍**。一次研究要跑几十次搜索 + 几十次抓取，并行就是双倍 API 费用。这种钱不能烧
2. **结果会污染**。两个 Provider 排序逻辑不一样，并行合并后去重、加权都是麻烦事，反而稀释证据质量

所以 Contritas 选了降级（fallback chain）。具体到两层：

```
搜索层（找 URL）：    Tavily → Serper
抓取层（拿正文）：    Jina → Firecrawl → Web Archive
```

**搜索层只两级，抓取层三级**。这个不对称是有理由的——下面拆开讲。

---

## 三、搜索层：为什么 Tavily 是主、Serper 是备？

看 `packages/search/src/orchestrator.ts:210` 的 `searchWithFallback`：

```typescript
private async searchWithFallback(params): Promise<SearchResult[]> {
  try {
    return await this.config.searchProvider.search(params);
  } catch (err) {
    if (this.config.fallbackSearchProvider) {
      return await this.config.fallbackSearchProvider.search(params);
    }
    throw err;
  }
}
```

只有抛错才走 fallback，**返回空数组不算失败**。这是有意的——Tavily 偶尔会对生僻 query 返回空（合法行为，不是抖动），如果一空就降级，会平白多花一倍钱。

至于为什么 Tavily 主、Serper 备：

| 维度 | Tavily | Serper |
|------|--------|--------|
| 设计目标 | 给 AI / RAG 用的搜索 | Google SERP API |
| 摘要质量 | 已经做过 LLM-friendly 整理 | 原始 SERP 摘要 |
| advanced 模式 | 会返回更长正文片段 | 仅链接 + meta |
| 价格 | 略贵 | 略便宜 |
| 稳定性 | 偶尔慢 / 抽风 | 较稳 |

**Tavily 的优势在"已经为 AI 调用做过预处理"**——很多时候它返回的摘要已经够 LLM 判断相关性，不需要再花一次抓取调用。这对成本敏感的场景是关键优化。

Serper 是 Google SERP 的直管道，结果更原始、覆盖面更广（包括 Tavily 漏掉的小众站点），适合做兜底。

**所以两级的分工是：主要解决"日常 80% 命题"，备用兜"长尾 20% 和 Tavily 抽风时刻"**。再加第三家就是过度工程——边际收益不够，运维成本翻倍。

---

## 四、抓取层：为什么需要三级？

抓取（content extraction）这件事比搜索难得多，原因是网页生态本身就是一团乱麻：

- 静态 HTML 网站 → 任何抓取器都行
- JS-heavy SPA → 必须浏览器渲染
- 付费墙 → 任何抓取器都拿不到正文
- 地区限制 / 临时下线 → 当下抓不到，但 Web Archive 可能有快照

一级降级（Jina → Firecrawl）只解决了前两类。第三、四类必须有第三级 Web Archive 兜底。

看 `packages/search/src/extractors/fallback-chain.ts:14`：

```typescript
async extract(url: string): Promise<ExtractedContent> {
  let lastError = "";

  for (const extractor of this.extractors) {
    const result = await extractor.extract(url);
    if (result.success && result.content.length > 0) {
      return result;
    }
    lastError = result.error ?? `${extractor.name} returned empty content`;
  }

  return {
    url,
    title: "",
    content: "",
    wordCount: 0,
    success: false,
    error: `All extractors failed. Last error: ${lastError}`,
  };
}
```

注意第 19 行那个 `result.content.length > 0`——这是和搜索层不一样的判断。

**抓取层"成功但内容为空"等价于失败，必须降级**。原因是 Jina 这种轻量抓取器对反爬重的页面会"成功"返回一段假内容（只有页脚或弹窗内容）。如果不卡这道关，后面 LLM 拿到一篇空文档去评估，结论就是"这条证据不相关"——明明是抓取失败，被记成了"页面无关"。这是非常隐蔽的 bug。

### 三级各自的角色

```
Jina Reader     → 80% 的页面，免费额度大，速度快
Firecrawl       → 反爬严重 / JS-heavy 的页面，付费但稳
Web Archive     → 时效不强但渠道封了的内容，至少有快照
```

**为什么不在 Web Archive 之前再加一层 puppeteer 自渲染？**

- 自渲染要养一套 headless 集群，运维成本高
- Firecrawl 已经覆盖了主流 JS 场景
- 自渲染绕不过反爬识别（IP / 指纹 / captcha）

**取而代之，把"无法抓取"作为正常状态接受**——这是后面那条产品纪律的核心，下一节展开。

---

## 五、最重要的工程纪律："证据不足"是合法状态

到这里前四节都是搜索/抓取的工程细节。但这篇文章真正想讲的是下面这条原则——它比所有技术选型都重要：

> **抓不到就是抓不到。允许"证据不足"作为合法的尽调结果，但绝对不允许 LLM 编一段。**

### 5.1 错误做法

很多 AI 应用面对抓取失败，会做下面这些事：

- 把搜索结果的 snippet 当正文塞给 LLM（snippet 只有 200 字，多半是 SEO 描述）
- 把 URL 标题塞给 LLM 让它"基于标题判断"（等同于让它瞎猜）
- 直接跳过失败的 URL，假装它不存在

第一种最常见，也最阴险——**用 snippet 当正文，LLM 会"基于这段不完整的信息合理推测"，输出看起来很专业，但和真实页面没关系**。报告里写"据 X 公司财报披露……"，实际上财报根本没抓到，LLM 看的是搜索结果摘要。

这就是**幻觉证据**。比 LLM 凭空编结论更难发现，因为它看起来有引用。

### 5.2 Contritas 的做法

orchestrator 在抓取后立刻过滤：

```typescript
// orchestrator.ts:244
return extracted.filter((e) => e.success && e.content.length > 100);
```

抓取失败的、内容太短的，**直接从评估流程里剔除**——不进 LLM 上下文。LLM 只能基于真实抓到的全文做判断。

然后在 isSufficient 这个 sufficient 检查里：

```typescript
// orchestrator.ts:358
private isSufficient(evidence: EvidenceCandidate[]): boolean {
  const uniqueUrls = new Set(evidence.map((e) => e.url)).size;
  const highCredibility = evidence.filter((e) => e.credibility === "high").length;
  return uniqueUrls >= MIN_SOURCES_PER_DIMENSION
      && highCredibility >= MIN_HIGH_CREDIBILITY_SOURCES;
}
```

`MIN_SOURCES_PER_DIMENSION = 3`、`MIN_HIGH_CREDIBILITY_SOURCES = 2`（见 `packages/shared/src/constants.ts`）。

如果一个维度跑完最大轮数还没达标，**它就是没达标**——不会被偷偷凑数，会在最终报告里被显式标注为"证据不足，置信度降级"。

### 5.3 为什么这条纪律比技术更重要

任何一个环节松一点，都会让"证据不足"被悄悄掩盖：

- 抓取失败 → 用 snippet 顶上 → 看起来证据数够了
- 抓到一半 → 让 LLM"基于现有信息推测剩下的" → 看起来结论充分
- 高可信源不够 → 把博客文章标成"high credibility" → 看起来权威

**每一步妥协单看都"很合理"，加起来就是一份充满幻觉证据的尽调报告**。然后用户基于这份报告做了决策，亏了钱，回来骂。

Contritas 选的相反路径是：**让"证据不足"在产品和报告里都是一等公民**——

- 报告里会写"维度 X：仅获得 2 条来源，未达最低 3 条门槛，结论置信度降至 ⚠️ 存疑"
- 用户能看到具体是哪个维度抓不动，可以人工补料后再迭代
- 模型不会被诱导去填补本不该存在的细节

这件事说起来简单，但需要从抓取层、orchestrator、prompt、报告 schema、UI 显示**一路贯穿**才不会破功。任何一处妥协，整条纪律就崩了。

---

## 六、缓存的边界：哪些能复用，哪些不能

降级链解决"抓不到怎么办"，缓存解决"抓到了别白抓"。但缓存设计稍有不慎也会破纪律——所以单独拎出来讲。

### 6.1 两套缓存，不同 TTL

```
搜索结果缓存：24 小时（key = provider:lang:query）
正文抓取缓存：24 小时（key = sha256(url) 前 16 位）
```

为什么都是 24h？因为尽调命题大多在数日内被反复研究（同一个用户深挖、不同用户撞题），日级缓存能命中大量重复请求；但超过 24h 就有时效性风险——尤其是商业类命题，新闻一天能反转好几次。

`SEARCH_CACHE_TTL_SECONDS = 24 * 3600`，定义在 `packages/shared/src/constants.ts:20`。

### 6.2 cache key 设计有讲究

看 `packages/search/src/cache.ts:47`：

```typescript
export function buildCacheKey(query: string, language: string, provider?: string): string {
  const parts = provider ? [provider, language, query] : [language, query];
  return parts.join(":");
}
```

注意 **provider 是 key 的一部分**。这是为了：

- Tavily 和 Serper 同一 query 的结果不一样，不能互相污染缓存
- 当主 Provider 切换时（比如 Tavily 不可用切到 Serper），新 Provider 的结果有自己的缓存空间，不会拿旧 Tavily 缓存当 Serper 结果

`language` 也单独做 key 的一部分——中英双语搜索结果差别极大，混了等于没缓存。

### 6.3 什么不能缓存

- **LLM 对证据的评估结果**不能用 URL 做 key 缓存——同一篇文档在不同维度下相关性不同
- **抓取失败**不缓存——可能下次再试就成了（IP 不同、Firecrawl 升级了规则等）

第二点容易漏：很多人会把"抓取失败"也缓存以避免重复尝试。但抓取失败的根因往往是临时性的（rate limit、503、CDN 抖动），缓存失败 = 永久放弃这条 URL。Contritas 只缓存成功抓取，失败下次重新走降级链：

```typescript
// orchestrator.ts:235
if (extracted.success && this.config.contentCache) {
  await this.config.contentCache.set(r.url, extracted, SEARCH_CACHE_TTL_SECONDS);
}
```

`extracted.success` 这一道判断保证了失败不入缓存。

---

## 七、还没做、但要做的事

诚实补一段未来工作——这篇文章的素材并非全部完成。

### 7.1 真实抓取失败率埋点

到目前为止，Contritas 还没系统统计 Jina / Firecrawl / Web Archive 各自的命中率分布。**这是一个明显的盲点**——选型决策都是基于经验和小样本，但没有产线数据校准。

短期内要做：

- 在每一级 extractor 入口/出口埋点（用时、成功标志、错误类型）
- 按"目标域名 → 命中级别"做一张矩阵，找出哪些站点必须直接走 Firecrawl 或 Web Archive，跳过 Jina 节省一次失败调用
- 把统计回灌到 orchestrator，做"按域名预选 extractor"的优化

这部分数据攒齐后，会单独出一篇带数字的复盘——这篇先把方法论和工程结构讲清楚。

### 7.2 反爬识别

目前抓取失败一律走完三级。但有些站点（比如 Cloudflare 反爬激活的、需要登录的、显式 robots.txt 拒绝的）三级都不可能成功——这种应该提前识别、跳过、节省调用配额。这块还没做。

### 7.3 Web Archive 时效标注

走到 Web Archive 兜底的内容，本质上是历史快照，可能比真实页面晚几个月。当前没有显式标注这一点——证据库里这种内容应该带"时效降级"标记，让 Phase 4 交叉验证时知道这是过时数据。这是一个还在 backlog 的小工单。

---

## 八、收尾

这篇没什么花哨的东西。降级链是个老主意，缓存设计也不是什么新发明。但**把这三件事拼到一起，并且死守"证据不足是合法状态"这条产品纪律**——这不是技术问题，是判断问题。

回到文章开头那句话：

> AI 应用最容易翻车的地方，不是 LLM。

是数据进 LLM 之前的那一段路。

LLM 能力会随版本升级飞快变强。但**抓不到就是抓不到**这件事，未来五年也不会变——网站会反爬、付费墙会扩张、地区限制会更严。**唯一能让你的 Agent 在这件事上不翻车的，是工程纪律**：让降级链该降级、让缓存该过期、让"证据不足"在报告里有自己的位置。

不掩盖缺失，就是 Contritas 的承诺里被讨论得最少、但最重要的一条。

---

下一篇（候选）：**报告自检（Phase 5 self-check）—— 让 LLM 给自己挑刺**。如果说本系列前几篇讲"前置怎么逼 LLM 守纪律"，那篇讲"后置怎么发现 LLM 没守纪律"——schema 校验 + 反证覆盖率 + 引用完整性的三道硬约束，是反讨好系列的最后一块拼图。

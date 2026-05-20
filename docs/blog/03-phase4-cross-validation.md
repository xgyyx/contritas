# Phase 4 交叉验证：让 LLM 找证据矛盾，而不是顺着事实线挑顺耳的写

> 本系列前两篇：
> 1. [《我做了一个会跟你唱反调的 AI 尽调 Agent——聊聊 Contritas 的架构与选型》](./01-architecture-and-stack.md)
> 2. [《怎么让 LLM 跟你唱反调——Contritas 是怎么把"反驳"写进 Prompt 的》](./02-anti-flattery-prompt-design.md)

---

## 一、"交叉验证"这个词大多数人在乱用

很多 AI 应用的"交叉验证"长这样：

```
拿到一堆证据 → 让 LLM 看一眼 → "请综合判断这些证据是否一致"
```

听着挺合理，实际跑起来的输出长这样：

> "综合多方信息来看，市场前景基本一致看好，部分数据存在小幅出入但不影响整体判断。"

这是**伪验证**。它没有：

- 没有把"支持的证据"和"削弱的证据"分开看
- 没有指出**具体哪两条**在打架
- 没有解释矛盾的**原因**
- 没有把"一致 / 不一致"和"可信度"解耦

如果尽调流程的"验证"环节只是这个水平，那它的全部价值就是给报告添个段落，**对决策毫无作用**。

Contritas 的 Phase 4 想做的是相反的事——把"看看证据是否一致"这个模糊指令，**结构化拆解成一个有输入格式、有矛盾归因、有 verdict 与 confidence 解耦的工程问题**。

下面是具体怎么做的。

---

## 二、第一道关：证据从生成时就被打了"立场标签"

交叉验证的有效性取决于输入的结构。如果证据是一团均匀的文本，LLM 永远会得出"基本一致"。

所以第一刀要在 Phase 3 抽取时就切下去。看 `packages/llm/src/prompts/phase3-extract.ts`：

```typescript
relationship: z.enum(["supports", "weakens", "qualifies"]),
```

每条证据在被存下来的时候，都必须带一个**与命题的关系标签**：

- `supports` — 证据支持/确认命题
- `weakens` — 证据反驳/削弱命题
- `qualifies` — 证据增加细微差别或条件（部分支持、部分削弱）

这一步是后面所有验证逻辑的根基。**只有当证据被预先打上立场标签，矛盾才能被自动检测出来——否则你只能让 LLM 现读现想，那就回到伪验证了。**

注意 `qualifies` 这个第三类。很多团队的 schema 里只有 `supports / weakens` 二分，但现实里大部分证据是"看情况"——A 公司在欧洲市场表现强，但在亚太市场弱。这种证据不能算"支持"也不能算"削弱"，只能算"附带条件"。**强行二分会把这种最有信息量的证据都丢了。**

`qualifies` 这个类别专门收纳"有条件的支持/削弱"，让后面的验证 prompt 能区别对待。

---

## 三、第二道关：结构化重组——supports / weakens / qualifies 三栏对照

Phase 4 的 Actor 实现在 `packages/workflow/src/actors/cross-validate.ts`。它的关键工作不是调 LLM，**而是在调 LLM 之前先把证据按维度 + 立场重组成三栏对照表**。

核心代码：

```typescript
const supports = evidenceList.filter((e) => e.relationship === "supports");
const weakens = evidenceList.filter((e) => e.relationship === "weakens");
const qualifies = evidenceList.filter((e) => e.relationship === "qualifies");

dimensionSections.push(
  `### Dimension: ${dimId}\n` +
    `Evidence count: ${evidenceList.length}\n\n` +
    `**Supports (${supports.length}):**\n${supports.length > 0 ? formatEvidence(supports) : "  (none)"}\n\n` +
    `**Weakens (${weakens.length}):**\n${weakens.length > 0 ? formatEvidence(weakens) : "  (none)"}\n\n` +
    `**Qualifies (${qualifies.length}):**\n${qualifies.length > 0 ? formatEvidence(qualifies) : "  (none)"}`
);
```

这段代码做了一件事：**把"找矛盾"这个开放性问题，重组成"看一张三栏对照表"这个封闭性问题**。

LLM 拿到的输入大概长这样：

```
### Dimension: market-size

Evidence count: 6

**Supports (3):**
  [1] "IDC Report 2025" (credibility: high, date: 2025-03)
      Excerpt: 全球 SaaS 市场规模将达 3000 亿美元...
  [2] "Gartner Q2 Forecast" (credibility: high, date: 2025-04)
      Excerpt: 复合增长率 14.3%...
  [3] "PitchBook" (credibility: medium, date: 2025-02)
      ...

**Weakens (2):**
  [1] "中国信通院" (credibility: high, date: 2025-05)
      Excerpt: 国内 SaaS 市场规模 580 亿元，增速放缓至 8%...
  [2] "Crunchbase Top 100" (credibility: medium, date: 2025-04)
      Excerpt: 头部公司 ARR 增速中位数从 35% 降至 22%...

**Qualifies (1):**
  [1] "McKinsey China" (credibility: high, date: 2025-01)
      Excerpt: 中国与全球市场分化明显...
```

这种排版让 LLM 立刻看见两件事：

1. **左右两栏不为空**——本维度的证据存在方向冲突，不能糊弄
2. **冲突的具体来源**——可以直接逐条比对、归因

如果不做这一步，把所有证据原样塞给 LLM，它会按文本顺序读完然后给一个综合印象。**这种做法相当于让法官看完六个证人陈述自己脑补对照——不如让书记员先把对立证词列成对照表给他。**

工程上的核心点是：**LLM 的输出质量高度依赖输入结构。让 prompt 处理结构化任务而不是开放任务，是提升输出可靠性的最便宜也最有效的手段。**

---

## 四、第三道关：让 LLM 把矛盾归类到四个具体原因

Phase 4 的输出 schema 是这样的（`phase4-cross-validate.ts`）：

```typescript
export const phase4OutputSchema = z.object({
  validations: z.array(
    z.object({
      dimensionId: z.string(),
      consistent: z.boolean(),
      contradictionDescription: z.string().optional(),
      contradictionReason: z
        .enum([
          "source_bias",
          "time_difference",
          "scope_mismatch",
          "methodology_difference",
        ])
        .optional(),
      verdict: z.enum(["supported", "disputed", "unsupported"]),
      confidence: z.enum(["high", "medium", "low"]),
      evidenceIds: z.array(z.string()),
    })
  ),
});
```

这个 schema 是整个 Phase 4 设计的核心。下面逐个拆。

### 4.1 contradictionReason 的四个枚举

prompt 里的具体定义：

```text
- source_bias            — 一个来源有明显的利益相关
                           (如公司 PR vs 独立分析)
- time_difference        — 不同时间段的证据反映了已变化的条件
- scope_mismatch         — 证据讨论的范围/地区/细分不同
- methodology_difference — 不同的测量方法或定义产生了不同的数字
```

这四个枚举是 Contritas Phase 4 最值得抄的设计。

为什么不让 LLM 写自由文本描述矛盾原因？因为**自由文本会滑头**。我跑过对比——同样的证据，让 LLM 写自由原因，它会说"由于不同来源对市场的看法存在差异，导致结论略有出入"。这种话基本等于啥也没说。

强制选 enum 之后，LLM 不得不**调出具体知识来支撑分类**。它会说"`scope_mismatch`，因为来源 A 讨论全球市场，来源 B 仅限中国市场"——这一句话立刻让矛盾变得可处置。

更重要的是：**每一个枚举都对应一个不同的下游处置方式**。

| 矛盾原因 | 报告里怎么写 | 评分上怎么处理 |
|---|---|---|
| `source_bias` | 标注偏见来源，优先采信独立来源 | 削弱评分置信度，但不必降级结论 |
| `time_difference` | 用更近的数据，旧数据作为趋势对比 | 通常以新数据为主结论 |
| `scope_mismatch` | 拆开报告，分别在对应口径下给结论 | **不能合并打分**，要分维度 |
| `methodology_difference` | 必须在评分说明里展示口径差异 | 双口径都要给一次评分 |

这是分类带来的工程红利——**枚举不是为了分类好看，是为了让下游有可被分发的信号**。

### 4.2 verdict 与 confidence 的解耦

很多系统会把"验证结果"做成单一字段：合格 / 不合格。Contritas 故意拆成两个：

```typescript
verdict: z.enum(["supported", "disputed", "unsupported"]),
confidence: z.enum(["high", "medium", "low"]),
```

这两个字段**正交**——任何组合都合法：

- `supported + high` — 多个高可信来源一致，无矛盾，最强结论
- `supported + low` — 主流看法支持，但来源少或可信度一般
- `disputed + high` — 多个高可信来源**强烈分歧**（最有意思的情况！）
- `disputed + low` — 弱证据下的模糊分歧
- `unsupported + high` — 高可信证据明确反驳
- `unsupported + low` — 证据不足以下结论

为什么这么设计？因为**"结论方向"和"我们对这个结论有多确定"是两个独立的事实**。

举个例子：联邦降息这个判断，可能多个高可信来源（联储官员讲话、CPI 数据、就业数据）同时出现，但**它们方向相反**——这是高质量信息下的真实分歧。

如果用单一字段表示"验证结果"，遇到这种情况只能给个含糊的 5 分。**拆成两个字段后**，可以诚实地输出 `disputed + high`：

> 这件事在专业层面确实有分歧，分歧不是因为证据少，而是因为证据本身指向不同方向。

这是给决策者最有用的信号之一——**"专业人士也吵不出结果"** 比 "看着好像挺一致" 价值高得多。

### 4.3 prompt 里的 verdict / confidence 分配规则

prompt 里把规则写得非常具体：

```text
### Verdict Assignment Rules

- supported   — 大多数证据（尤其是高可信）方向一致，无重大未解矛盾
- disputed    — 可信来源之间存在显著矛盾，无明显赢家
- unsupported — 证据不足以得出结论，OR 大多数证据反驳命题

### Confidence Assignment Rules

- high   — 3+ 高可信来源一致，无重大矛盾
- medium — 支持与限定证据混合，或仅有中等可信来源
- low    — 来源少、存在矛盾、或仅有低可信证据
```

注意一件事：**这两套规则没有共享变量**。

- verdict 看的是 **方向一致性**（majority direction）
- confidence 看的是 **来源质量与数量**（source quality, count）

正是因为输入维度不同，输出才能正交。如果你看到任何 schema 里 verdict 和 confidence 是同一套判断标准的不同档位，那它们就是**伪正交**——本质上是一个指标。

### 4.4 特殊情形：证据少于 2 条

prompt 里有一条容易被忽略但很关键的规则：

```text
Special Cases:
- If a dimension has fewer than 2 evidence items: mark as consistent
  (no contradiction possible), but set confidence to "low"
```

为什么要写这条？

LLM 处理"只有 1 条证据"这种边角情况时容易乱来——有的版本会强行说"一致"并给高置信度（因为没看到矛盾），有的版本会说"未知"。

这条规则把它绑死：**没办法证伪 ≠ 已被证实**。逻辑上没矛盾要标 consistent，但置信度必须降到 low——因为我们根本没看到第二个声音。

很多 LLM 的判断错误来自把"未知"误算成"已知"，这种规则就是在 schema 层堵这个洞。

---

## 五、第四道关：用代码兜底，验明 evidenceIds 完整性

cross-validate Actor 的最后一段有这么个细节：

```typescript
const crossValidations = data.validations.map((v) => {
  const dimEvidence = evidenceByDimension.get(v.dimensionId) ?? [];
  return {
    dimensionId: v.dimensionId,
    evidenceIds: v.evidenceIds.length > 0
      ? v.evidenceIds
      : dimEvidence.map((_, i) => `${v.dimensionId}:${i}`),
    // ...
  };
});
```

这是给 LLM 兜底的——LLM 偶尔会偷懒只列出"参与矛盾的证据 ID"，不把所有证据 ID 都列出来。代码这里加了一层兜底：如果 LLM 返回的 evidenceIds 为空，就**自动补全为该维度下所有证据**。

这种"prompt 说应该这样、代码兜底确保如此"的双层保险，在 Contritas 里到处都是。**它不是不信任 LLM，而是承认 LLM 是概率系统——总有一定概率不按 prompt 来，那就在代码层补一道。**

prompt 里这条要求其实写得很明确：

```text
Always include ALL evidence IDs for the dimension in the evidenceIds array
(not just contradicting ones)
```

但在生产环境里，"prompt 写了但 LLM 偶尔不遵守"是常态。**信任但验证**是 LLM 工程的基本心态。

---

## 六、第五道关：self-check 把缺漏堵死

Phase 4 之后还有 Phase 5 报告生成 + 自检环节。`packages/workflow/src/utils/self-check.ts` 里的关键代码：

```typescript
function checkEvidenceCoverage(
  context: ResearchContext,
  failures: SelfCheckFailure[]
): void {
  const evidenceByDimension = new Map<string, typeof context.evidence>();
  for (const ev of context.evidence) {
    const list = evidenceByDimension.get(ev.dimensionId) ?? [];
    list.push(ev);
    evidenceByDimension.set(ev.dimensionId, list);
  }

  for (const [dimId, evidenceList] of evidenceByDimension) {
    if (evidenceList.length < MIN_EVIDENCE_FOR_REPORT) {
      failures.push({
        check: "evidence_coverage",
        dimensionId: dimId,
        reason: `Dimension ${dimId} has only ${evidenceList.length} evidence items (minimum: ${MIN_EVIDENCE_FOR_REPORT})`,
      });
    }

    const highCredibility = evidenceList.filter((e) => e.credibility === "high").length;
    if (highCredibility < MIN_HIGH_CREDIBILITY_FOR_REPORT) {
      failures.push({
        check: "high_credibility_evidence",
        dimensionId: dimId,
        reason: `Dimension ${dimId} has only ${highCredibility} high-credibility sources (minimum: ${MIN_HIGH_CREDIBILITY_FOR_REPORT})`,
      });
    }
  }
}
```

每个维度必须满足两条**确定性约束**：

1. 总证据 ≥ MIN_EVIDENCE_FOR_REPORT（默认 3）
2. 高可信证据 ≥ MIN_HIGH_CREDIBILITY_FOR_REPORT（默认 1）

不达标的维度直接进 `failedChecks`，触发 XState 状态机回退到 Phase 3 补充检索（最多 1 次）。

为什么要在 LLM 验证之外再加一层确定性代码检查？

**因为 LLM 自己永远不会承认证据不够。** 你把 1 条证据塞给它问"这够不够下结论"，它大概率会说"基于现有信息可以得出 xxx 倾向"。LLM 的本能是给答案，不是承认无力。

self-check 是非 LLM 的、纯逻辑的硬约束——**它不参与判断内容质量，只验证数量底线**。这种"代码守门员"和"LLM 判断官"的角色分离，是 Phase 4 + Phase 5 整套体系最值得借鉴的工程模式。

---

## 七、整套机制的拼图

把上面五道关画在一起：

```
Phase 3 抽取证据
    │
    ├── relationship 必须是 supports/weakens/qualifies 之一
    │   (Schema 强约束)
    │
    ▼
Phase 4 准备输入
    │
    ├── 按维度分组 + 三栏对照重组
    │   (代码层结构化，LLM 看到的是表，不是文本)
    │
    ▼
Phase 4 LLM 验证
    │
    ├── contradictionReason 必须是四个枚举之一
    ├── verdict 与 confidence 必须分别给
    └── 输出有 Zod schema 校验
    │
    ▼
Phase 4 代码兜底
    │
    └── evidenceIds 缺失时自动补全
    │
    ▼
Phase 5 self-check
    │
    ├── 每维度证据数量 ≥ 3
    ├── 每维度高可信证据 ≥ 1
    └── 不通过 → XState guard → 回退 Phase 3
```

每一关都是不可替代的：

- 缺第一关，证据没立场标签，没法检测矛盾
- 缺第二关，LLM 拿到的是文本流，不是对照表
- 缺第三关，矛盾原因写自由文本，下游没法分发
- 缺第四关，LLM 偶尔的偷懒会污染数据
- 缺第五关，证据不足时强行出报告，self-check 之前就漏了

任何一关的失败都会让整个交叉验证退化成"伪验证"。**这就是为什么 LLM 应用看着简单，工程上一点都不简单——你需要在多个层级同时设防，才能把模型的"概率倾向"约束成"确定性输出"。**

---

## 八、几条可以拿走的工程经验

把这一篇压缩成几条建议：

**1. 验证不能只在最后一步做。** 验证有效性的根在数据生成时——在 Phase 3 抽取证据时就给每条证据打 relationship 标签，后面才能做结构化对比。如果输入数据没有结构，再好的 prompt 也救不回来。

**2. 让 LLM 处理结构化输入而不是开放输入。** 把"找矛盾"这种开放问题，通过代码层重组成"对照三栏表"这种封闭问题。LLM 在封闭任务上的表现远好于开放任务。

**3. 把"原因"做成 enum，下游才能分发。** 自由文本好写但下游用不了；枚举难写但每个值都能映射到不同处置。**枚举是 LLM 输出的"接口契约"，自由文本是"内部备忘"。**

**4. 把"结论"和"信心"拆成正交字段。** 单一字段会损失信息——专业人士的真实分歧（disputed + high）会被退化成"中等评分"。两个正交字段才能表达"这件事高质量证据下确实有分歧"。

**5. 信任但验证。** Prompt 写"必须包含所有 ID"是软约束，代码补全才是硬约束。LLM 是概率系统，工程层必须假设它会偶尔不按规矩来。

**6. 让代码做守门员，让 LLM 做判断官。** 数量底线、字段存在性、格式合规——这些用代码 self-check。判断质量、分类原因、综合结论——这些交给 LLM。**职责分清，系统才稳。**

---

## 九、下一篇

下一篇打算写"AI Agent 的 LLM 成本治理"——Model Router 怎么按 phase 路由、Token 预算怎么主动止损、缓存策略怎么设计。这是任何做 AI 应用的人都会遇到的痛点。

仓库：

> GitHub: [Contritas](https://github.com/wb-yyx453122/Contritas)
>
> Slogan: _Grind assumptions. Surface truth._

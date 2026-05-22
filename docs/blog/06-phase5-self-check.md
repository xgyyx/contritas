# 报告自检（Phase 5 self-check）—— 让 LLM 给自己挑刺

> 本系列前几篇：
> 1. [《我做了一个会跟你唱反调的 AI 尽调 Agent——聊聊 Contritas 的架构与选型》](./01-architecture-and-stack.md)
> 2. [《怎么让 LLM 跟你唱反调——Contritas 是怎么把"反驳"写进 Prompt 的》](./02-anti-flattery-prompt-design.md)
> 3. [《Phase 4 交叉验证：让 LLM 找证据矛盾》](./03-phase4-cross-validation.md)
> 4. [《如果你能用 Claude Code，为什么还要 Contritas？》](./04-vs-general-agent.md)
> 5. [《搜索降级链与"接受部分缺失"的工程纪律》](./05-search-fallback-and-evidence-discipline.md)

---

## 一、"让 LLM 自己检查报告"——这个想法听起来很美，跑起来全废

如果一个 Agent 写完报告之后，能"自己"挑出问题、自己回去补，这听上去是 Agent 工程最性感的能力之一。市面上很多文章把它写得很神：

```
Agent 写完 → Agent reflect → Agent 评分 → 不达标继续改
```

LLM-as-judge、self-reflection、constitutional AI 这些词用上去都对。但有一个细节没人爱讲：

> **让 LLM 评判自己的输出，是 LLM-as-judge 应用里失败率最高的场景之一。**

为什么？写报告这件事，模型已经把全部"它觉得对的判断"都写进去了。再让它回头审，等于让一个考生把自己的答卷拿去再判一遍——它当然觉得自己对。研究里这个偏差有名字叫 **self-preference bias**，它是稳定可复现的，不是抖动。

更糟的是，当你强迫它"找问题"，它会**编一些不痛不痒的小问题**来交差：

> "本报告论述较为充分，建议在第三部分补充更多近期数据以增强时效性。"

这种"自检"本质上是装样子。它没有任何信息量，但报告会因为它走完了"自检"这道流程而显得更可信——**这是比没有自检更危险的事**。

Contritas 的 Phase 5 自检，特意**没有**用 LLM 来评判 LLM。它用的是**四道纯代码的硬约束 + 失败回退状态机**。这篇就讲这个。

---

## 二、自检的底层认知：你能查的，不是"对不对"，是"完不完整"

LLM 自评失败的根因是：**"对不对"是模型的判断，让模型评模型的判断没意义**。

但 Phase 5 报告的问题，大部分根本不是"对不对"——是**"完不完整"**：

- 反向质疑章节漏掉了某个维度
- 某个维度引用的证据不够
- 高可信源数量不达标
- 参考来源表是空的
- 评分章节没解释"为什么不更高 / 为什么不更低"

这些都是**结构性缺失**，是规则可判定的事——不需要 LLM。**判官不该是 LLM，应该是代码。**

这是 Contritas 自检的核心设计认知。看 `packages/workflow/src/utils/self-check.ts:6-7` 的注释：

```typescript
/**
 * Run the 4 mandatory self-checks on a generated report.
 * These are deterministic code checks, NOT LLM-based.
 */
```

"NOT LLM-based" 这一行是斜体加粗写在原代码里的——就是要提醒后来者，**别图省事改成 LLM 自评**。

---

## 三、四道硬约束，逐道拆开

### 3.1 反向质疑覆盖：每个维度都要有反驳章节

`checkCounterQuestions`（self-check.ts:32）：

```typescript
const counterQuestionPattern = /#{1,4}\s*(反向质疑|Counter[-\s]?[Qq]uestion)/g;
const matches = markdown.match(counterQuestionPattern) ?? [];

const dimensionIds = new Set(context.evidence.map((e) => e.dimensionId));
const dimensionCount = dimensionIds.size;

if (matches.length < dimensionCount) {
  failures.push({
    check: "counter_questions",
    reason: `Found ${matches.length} counter-question sections but expected ${dimensionCount}`,
  });
}
```

逻辑很糙：数 markdown 里有几个二级/三级标题写"反向质疑"或"Counter-Question"，跟实际的维度数量比对。少一个就 fail。

**为什么这个糙的检查比 LLM 自评好？**

因为 LLM 在写报告时如果偷懒——比如某个维度它觉得"没什么好反驳的"就跳过——这个偷懒的痕迹会**直接体现在 markdown 结构上**：少一节就是少一节，模型骗不了字符串匹配。

而如果让 LLM 自评，模型会解释："维度 X 的反向论证已经融合进正文了，不需要单独章节。"——听起来很合理，实际上就是没写。

**结构是 LLM 守不住的细节，恰恰是工具最容易抓的细节**。这是反讨好系列里反复出现的一个观察：把 LLM 没法骗的事抓住，就抓住了纪律。

### 3.2 证据覆盖：每个维度都要有最低数量的证据

`checkEvidenceCoverage`（self-check.ts:54）：

```typescript
const evidenceByDimension = new Map();
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
  // ... 还会检查 high credibility 数量
}
```

`MIN_EVIDENCE_FOR_REPORT = 3` / `MIN_HIGH_CREDIBILITY_FOR_REPORT = 1`，定义在 `packages/shared/src/constants.ts`。

**注意一个细节**：这里检查的是 `context.evidence`（数据库里的证据记录），不是 markdown 里的引用。这是有意的——

- 检查 markdown 引用 = 检查"模型有没有写到证据"
- 检查数据库 evidence = 检查"模型有没有为这个维度搜到证据"

后者更根本。如果某个维度根本没搜到足够证据，再强迫模型写也是空气结论。**这一道检查会触发"回到 Phase 3 重搜"，下面会展开。**

### 3.3 参考来源表存在且非空

`checkSourceTable`（self-check.ts:86）：

```typescript
const hasSourceSection = /#{1,4}\s*(八、参考来源|参考来源|References|Sources)/i.test(markdown);
if (!hasSourceSection) {
  failures.push({ check: "source_table", reason: "Report is missing the reference source table section" });
  return;
}

// Check that the table has at least one data row
const sourceSection = markdown.split(/#{1,4}\s*(八、参考来源|参考来源|References|Sources)/i).pop() ?? "";
const tableRows = sourceSection
  .split("\n")
  .filter((line) => line.includes("|") && !line.match(/^\s*\|?\s*[-:]+/));
const dataRows = tableRows.length > 1 ? tableRows.length - 1 : 0;

if (dataRows === 0) {
  failures.push({ check: "source_table", reason: "Reference source table exists but contains no entries" });
}
```

**为什么单独查这个？**

报告模板要求最后必须有完整的参考来源表（编号 / 来源 / URL / 可信度 / 抓取时间）。这是**审计性的来源**——任何一条结论都能追溯到这张表里的一行。

LLM 在写长报告时，最容易偷懒的就是这张表——前面写得激情澎湃，到末尾"参考来源表"那块敷衍两行，或者直接漏掉。

字符串规则查"有没有这一节 + 有没有数据行"两道——**模型偷懒会被立刻抓**。

### 3.4 评分解释包含"为什么不更高 / 为什么不更低"

`checkScoreExplanation`（self-check.ts:116）：

```typescript
const hasWhyNotHigher =
  /为什么不是更高|为什么不更高|why not higher|不是更高/i.test(scoreSection) ||
  /评分说明/.test(scoreSection);

const hasWhyNotLower =
  /为什么不是更低|为什么不更低|why not lower|不是更低/i.test(scoreSection) ||
  /评分说明/.test(scoreSection);

if (!hasWhyNotHigher && !hasWhyNotLower) {
  failures.push({
    check: "score_explanation",
    reason: "Score explanation does not include 'why not higher' and 'why not lower' analysis",
  });
}
```

这一道是**反讨好哲学的硬执行点**。

详见 [《怎么让 LLM 跟你唱反调》](./02-anti-flattery-prompt-design.md) 第五节——评分必须双向解释，否则 LLM 会自然地往"中庸偏支持"的方向滑，给一个 7.5 然后说"基本可行"。

强制要求"为什么不是 9 / 为什么不是 5"双向解释，能逼出真正的判断逻辑。**而这个要求只能用规则强制**——LLM 自评不会主动质疑自己评分的中庸性。

---

## 四、自检失败之后：回退 Phase 3，定向重搜

四道检查里，第二道（evidence_coverage）和其他三道有本质区别：

- 1 / 3 / 4 是**写法问题**——重写报告就行
- 2 是**数据问题**——证据本身不够，重写没用，必须重新搜

所以失败处理逻辑是分叉的。看 `packages/workflow/src/machine.ts:419-447`：

```typescript
onDone: [
  {
    guard: ({ event, context }) => {
      const result = event.output as SynthesisResult;
      return !result.selfCheck.passed && context.selfCheckRetries < MAX_SELF_CHECK_RETRIES;
    },
    target: "retrieval",   // ← 回到 Phase 3
    actions: [
      assign({
        selfCheckRetries: ({ context }) => context.selfCheckRetries + 1,
        targetedDimensions: ({ event }) => {
          const result = event.output as SynthesisResult;
          return result.selfCheck.failedChecks
            .filter((f) => f.dimensionId)        // ← 只取带 dimensionId 的失败
            .map((f) => f.dimensionId!);
        },
        // ...
      }),
      () => { deps.emitEvent({ type: "error", message: "Self-check failed, retrying with additional evidence", recoverable: true }); },
    ],
  },
  // ...其他分支
]
```

四个细节都重要：

1. **回退目标是 retrieval（Phase 3），不是 synthesis（Phase 5）**——证据不够就要去补证据，不是改文案
2. **`targetedDimensions` 只装带 dimensionId 的失败项**——只针对真正缺数据的维度重搜，不重新跑全部
3. **`MAX_SELF_CHECK_RETRIES = 1`**——只允许回退一次。再失败就让报告以"证据不足"标识完成，不无限循环烧钱
4. **`recoverable: true`**——通过 SSE 推给前端，用户能看到"自检不通过，正在补充证据"——而不是表面看起来卡住

第 3 点是产品判断：**自检不是为了让报告趋近完美，是为了过滤明显的偷懒**。一次回退能修的，是模型偷懒漏的；一次回退修不掉的，是这个命题本身就缺数据——这种情况应该如实输出"证据不足"，而不是反复重跑硬凑。

参见 [《搜索降级链与"接受部分缺失"的工程纪律》](./05-search-fallback-and-evidence-discipline.md) 第五节——"证据不足"是合法尽调结果。自检的回退上限正好兑现这条承诺。

---

## 五、为什么不再加一道"LLM 评质量"？

到这里有人会问：四道结构性检查覆盖了"完不完整"，那"对不对"还是漏的——能不能再加一道 LLM-as-judge 来评内容质量？

我犹豫过。最后没加。理由是：

### 5.1 LLM-as-judge 在自审场景几乎无效

如果让同一个模型去评自己写的报告，self-preference bias 会让它倾向给高分。这是文献里反复测出来的，不是观点。

如果换一个**不同的模型**去评（比如 Claude 写、GPT 评），理论上能减弱偏差，但成本翻倍、又引入了"两个模型谁说了算"的二次问题。

### 5.2 真正的内容质量问题应该靠前置纪律抓

"对不对"是判断质量的事——这件事 Contritas 已经在前面三个 Phase 里通过 prompt 工程 + 证据交叉验证强制约束了：

- Phase 1 拆假设的 importance 排序（[02 篇](./02-anti-flattery-prompt-design.md)）
- Phase 4 交叉验证的矛盾归因和 verdict 解耦（[03 篇](./03-phase4-cross-validation.md)）
- Phase 3 的反向关键词、证据立场标签（同 02 篇）

**前置约束做到位了，后置就不需要 LLM 再当一遍法官**。如果前置都没做好，后置那一道 LLM judge 也救不回来——它会一样被忽悠。

### 5.3 真要做 LLM judge，目标也不该是"质量评分"

未来如果要加一道 LLM 检查，更值得做的不是"评分"，而是**"找具体的失败模式"**：

- 有没有"基于 X 报告显示"这种引用了不存在内容的句式？
- 有没有"专家普遍认为"这种没有具体来源的群众陈述？
- 有没有数字和原证据中数字不一致？

这些是**具体的失败模式**，可以做成定向 prompt 让另一个模型查——但这是工程化的"找特定 bug"，不是泛化的"评质量"。这个方向在 backlog 里，不是优先项。

---

## 六、收尾

把"自检"这件事拆开，本质上只有一句话：

> **能用规则查的，不要让 LLM 评。**

四道硬约束加一次回退上限，**不是为了让自检看起来很厉害——是为了在尽调流程里堵住 LLM 最常见的偷懒模式**：

- 漏写反向质疑章节 → 字符串匹配抓
- 某个维度证据不够还硬写 → 数据层抓 → 回 Phase 3 补
- 参考来源表敷衍 → 表格行数抓
- 评分中庸不解释边界 → 关键词匹配抓

每一道单看都很粗暴。但加在一起，它们形成一个 LLM **没法用语言艺术绕开**的过滤网——你只能真的去把活干了，才能让自检过。

这是和 [02 篇](./02-anti-flattery-prompt-design.md)、[03 篇](./03-phase4-cross-validation.md) 一脉相承的同一个工程哲学：

> 反讨好不是写在 prompt 里的咒语，是从前置约束、中途校验、到后置自检**一路结构化**的纪律链。

LLM 越来越聪明，但聪明本身解决不了"它没动力跟你说真话"的问题——这一点，再大的模型也不会因为版本号变大而改善。

所以工程师的活，不是相信模型，是**给模型设一道它必须翻越的栅栏**。

至于栅栏漏了哪些 → 就是下一篇的事。

---

下一篇（候选）：
- **AI Agent 的 LLM 成本治理：Model Router + Token 预算 + 缓存三件套** —— 等真实成本数据攒齐后再写
- **为什么 Contritas 不做"实时浏览/深思考演示"？** —— 反 Devin / Manus 的产品哲学

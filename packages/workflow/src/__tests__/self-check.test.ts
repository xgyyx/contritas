import { describe, it, expect } from "vitest";
import { runSelfChecks } from "../utils/self-check.js";
import type { ResearchContext } from "../types.js";

function createMinimalContext(overrides?: Partial<ResearchContext>): ResearchContext {
  return {
    sessionId: "test-session",
    input: { originalText: "Test proposition", language: "zh" },
    assumptions: [],
    dimensions: [],
    evidence: [
      {
        id: "ev-1",
        dimensionId: "dim-1",
        url: "https://example.com/1",
        title: "Source 1",
        sourceName: "Official Gov",
        sourceType: "official_doc",
        credibility: "high",
        publishedDate: "2024-01-01",
        language: "zh",
        keyExcerpt: "Key data point",
        relationship: "supports",
        timelinessRisk: false,
        searchQuery: "test query",
        searchRound: 1,
      },
      {
        id: "ev-2",
        dimensionId: "dim-1",
        url: "https://example.com/2",
        title: "Source 2",
        sourceName: "Industry Report",
        sourceType: "industry_report",
        credibility: "medium",
        publishedDate: "2024-02-01",
        language: "zh",
        keyExcerpt: "Another data point",
        relationship: "supports",
        timelinessRisk: false,
        searchQuery: "test query 2",
        searchRound: 1,
      },
      {
        id: "ev-3",
        dimensionId: "dim-1",
        url: "https://example.com/3",
        title: "Source 3",
        sourceName: "Academic Paper",
        sourceType: "academic",
        credibility: "high",
        publishedDate: "2024-03-01",
        language: "en",
        keyExcerpt: "Third piece of evidence",
        relationship: "qualifies",
        timelinessRisk: false,
        searchQuery: "test query 3",
        searchRound: 2,
      },
    ],
    crossValidations: [],
    phases: [],
    currentPhase: "synthesis",
    clarificationHistory: [],
    tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCostUSD: 0 },
    searchCallsUsed: 0,
    selfCheckRetries: 0,
    ...overrides,
  };
}

const VALID_REPORT = `# 深度研究报告：Test

## 一、结论先行
- **总体判断**：测试结论
- **综合评分**：6.0-6.5 / 10

## 二、研究口径
- **本报告验证什么**：Test proposition

## 三、核心假设拆解
| # | 假设内容 | 类型 | 重要性 | 判断 | 证据强度 |
|---|---|---|---|---|---|
| 1 | Test assumption | 事实性 | 高 | ✅ | 强 |

## 四、分维度研究

### 维度 1：测试维度

#### 核心问题
测试核心问题

#### 反向质疑
如果假设不成立，可能因为什么？

#### 证据与观察
- **[1] Official Gov**（可信度：高）
  - 关键数据：Key data point

#### 分析与推论
基于证据的分析。

#### 阶段性结论
- **判断**：✅支持
- **置信度**：高

## 五、证据质量总览

### 高可信证据
| # | 来源 | 用于支撑的假设/维度 |
|---|---|---|
| 1 | Official Gov | 维度1 |

### 中等可信证据
| # | 来源 | 用于支撑的假设/维度 |
|---|---|---|
| 2 | Industry Report | 维度1 |

### 仍缺失的关键信息
- 无明显缺失

## 六、综合评估
| 维度 | 结论 | 证据强度 | 对总体结论的权重 | 风险等级 |
|---|---|---|---|---|
| 测试维度 | ✅ | 强 | 高 | 低 |

**评分说明**：综合评分6.0-6.5。为什么不是更高：缺少部分关键验证。为什么不是更低：核心证据较为充分。

## 七、建议

### 如果推进
1. 执行具体行动

### 如果暂缓
- 等待补充证据

### 如果否定/重构
- 核心假设不成立时的替代方向

## 八、参考来源
| # | 来源名称 | URL | 类型 | 可信度 | 摘要 |
|---|---|---|---|---|---|
| 1 | Official Gov | https://example.com/1 | 官方文档 | 高 | Key data point |
| 2 | Industry Report | https://example.com/2 | 行业报告 | 中 | Another data point |
| 3 | Academic Paper | https://example.com/3 | 学术 | 高 | Third piece of evidence |
`;

describe("Self-Check", () => {
  it("passes all checks with valid report and sufficient evidence", () => {
    const context = createMinimalContext();
    const result = runSelfChecks(VALID_REPORT, context);
    expect(result.passed).toBe(true);
    expect(result.failedChecks).toHaveLength(0);
  });

  it("fails when counter-question section is missing", () => {
    const reportWithoutCounterQ = VALID_REPORT.replace("#### 反向质疑\n如果假设不成立，可能因为什么？\n", "");
    const context = createMinimalContext();
    const result = runSelfChecks(reportWithoutCounterQ, context);
    expect(result.passed).toBe(false);
    expect(result.failedChecks.some((f) => f.check === "counter_questions")).toBe(true);
  });

  it("fails when evidence coverage is insufficient", () => {
    const context = createMinimalContext({
      evidence: [
        {
          id: "ev-low-1",
          dimensionId: "dim-1",
          url: "https://example.com/1",
          title: "Source 1",
          sourceName: "Blog",
          sourceType: "community",
          credibility: "low",
          language: "zh",
          keyExcerpt: "Some data",
          relationship: "supports",
          timelinessRisk: false,
          searchQuery: "q",
          searchRound: 1,
        },
        {
          id: "ev-low-2",
          dimensionId: "dim-1",
          url: "https://example.com/2",
          title: "Source 2",
          sourceName: "Forum",
          sourceType: "community",
          credibility: "low",
          language: "zh",
          keyExcerpt: "More data",
          relationship: "supports",
          timelinessRisk: false,
          searchQuery: "q2",
          searchRound: 1,
        },
      ],
    });
    const result = runSelfChecks(VALID_REPORT, context);
    expect(result.passed).toBe(false);
    expect(result.failedChecks.some((f) => f.check === "evidence_coverage")).toBe(true);
    expect(result.failedChecks.some((f) => f.check === "high_credibility_evidence")).toBe(true);
  });

  it("fails when source table is missing", () => {
    const reportWithoutSources = VALID_REPORT.split("## 八、参考来源")[0]!;
    const context = createMinimalContext();
    const result = runSelfChecks(reportWithoutSources, context);
    expect(result.passed).toBe(false);
    expect(result.failedChecks.some((f) => f.check === "source_table")).toBe(true);
  });

  it("fails when score explanation is missing", () => {
    const reportWithoutScore = VALID_REPORT.replace(
      "**评分说明**：综合评分6.0-6.5。为什么不是更高：缺少部分关键验证。为什么不是更低：核心证据较为充分。",
      ""
    ).replace("## 六、综合评估", "## 六、Other Section");
    const context = createMinimalContext();
    const result = runSelfChecks(reportWithoutScore, context);
    expect(result.passed).toBe(false);
    expect(result.failedChecks.some((f) => f.check === "score_explanation")).toBe(true);
  });
});

import { describe, it, expect, vi } from "vitest";
import { synthesizeReport } from "../actors/synthesize-report.js";
import type { ResearchContext, WorkflowDeps } from "../types.js";
import { MockProvider } from "@contritas/llm";

const MOCK_REPORT_CONTENT = `# 深度研究报告：Test

## 一、结论先行
- **总体判断**：测试结论有效
- **综合评分**：6.0-6.5 / 10

## 二、研究口径
- **本报告验证什么**：Test proposition

## 三、核心假设拆解
| # | 假设内容 | 类型 | 重要性 | 判断 | 证据强度 |
|---|---|---|---|---|---|
| 1 | Test assumption | 事实性 | 高 | ✅ | 强 |

## 四、分维度研究

### 维度 1：市场规模

#### 核心问题
市场是否足够大？

#### 反向质疑
如果市场实际上很小怎么办？

#### 证据与观察
- **[1] Gov Data** (可信度：高)
  - 关键数据：市场规模100亿
- **[2] Report** (可信度：中)
  - 关键数据：增长率20%
- **[3] Academic** (可信度：高)
  - 关键数据：可持续增长

#### 分析与推论
基于以上证据分析。

#### 阶段性结论
- **判断**：✅支持
- **置信度**：高

## 五、证据质量总览

### 高可信证据
| # | 来源 | 用于支撑的假设/维度 |
|---|---|---|
| 1 | Gov Data | 维度1 |
| 3 | Academic | 维度1 |

### 中等可信证据
| # | 来源 | 用于支撑的假设/维度 |
|---|---|---|
| 2 | Report | 维度1 |

### 仍缺失的关键信息
- 无

## 六、综合评估
| 维度 | 结论 | 证据强度 | 对总体结论的权重 | 风险等级 |
|---|---|---|---|---|
| 市场规模 | ✅ | 强 | 高 | 低 |

**评分说明**：综合评分6.0-6.5。为什么不是更高：仍有部分数据缺失。为什么不是更低：核心数据支撑充足。

## 七、建议

### 如果推进
1. 深入验证增长率

### 如果暂缓
- 等待Q4数据

### 如果否定/重构
- 转向其他赛道

## 八、参考来源
| # | 来源名称 | URL | 类型 | 可信度 | 摘要 |
|---|---|---|---|---|---|
| 1 | Gov Data | https://gov.cn/1 | 官方文档 | 高 | 市场数据 |
| 2 | Report | https://report.com/1 | 行业报告 | 中 | 增长数据 |
| 3 | Academic | https://paper.com/1 | 学术 | 高 | 研究结论 |
`;

function createMockDeps(responses: unknown[]): WorkflowDeps {
  const provider = new MockProvider({ structuredResponses: responses });
  return {
    llmProvider: provider,
    getModelForPhase: () => "mock-model",
    emitEvent: vi.fn(),
    persistState: vi.fn().mockResolvedValue(undefined),
  };
}

function createFullContext(): ResearchContext {
  return {
    sessionId: "test-session",
    input: {
      originalText: "Test proposition",
      validatedProposition: "Validated test proposition",
      language: "zh",
    },
    assumptions: [
      { id: "a1", content: "Market is large", type: "factual", importance: "high", order: 1 },
    ],
    dimensions: [
      {
        id: "dim-1",
        name: "市场规模",
        coreQuestion: "市场是否足够大？",
        counterQuestion: "市场是否已经饱和？",
        keywords: { zh: ["市场规模"], en: ["market size"] },
        relatedAssumptionIndices: [0],
      },
    ],
    evidence: [
      {
        id: "e1",
        dimensionId: "dim-1",
        url: "https://gov.cn/1",
        title: "Gov Data",
        sourceName: "Gov Data",
        sourceType: "official_doc",
        credibility: "high",
        language: "zh",
        keyExcerpt: "市场规模100亿",
        relationship: "supports",
        timelinessRisk: false,
        searchQuery: "q1",
        searchRound: 1,
      },
      {
        id: "e2",
        dimensionId: "dim-1",
        url: "https://report.com/1",
        title: "Report",
        sourceName: "Report",
        sourceType: "industry_report",
        credibility: "medium",
        language: "zh",
        keyExcerpt: "增长率20%",
        relationship: "supports",
        timelinessRisk: false,
        searchQuery: "q2",
        searchRound: 1,
      },
      {
        id: "e3",
        dimensionId: "dim-1",
        url: "https://paper.com/1",
        title: "Academic",
        sourceName: "Academic",
        sourceType: "academic",
        credibility: "high",
        language: "en",
        keyExcerpt: "Sustainable growth pattern",
        relationship: "supports",
        timelinessRisk: false,
        searchQuery: "q3",
        searchRound: 2,
      },
    ],
    crossValidations: [
      {
        id: "cv-1",
        dimensionId: "dim-1",
        evidenceIds: ["e1", "e2", "e3"],
        consistent: true,
        verdict: "supported",
        confidence: "high",
      },
    ],
    complexity: "low",
    phases: [],
    currentPhase: "synthesis",
    clarificationHistory: [],
    tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCostUSD: 0 },
    searchCallsUsed: 10,
    selfCheckRetries: 0,
  };
}

/** Invoke a fromPromise actor's underlying function directly */
function invokeActor(actor: any, input: any) {
  return actor.config({ input });
}

describe("Synthesize Report Actor", () => {
  it("generates report and passes self-check with valid output", async () => {
    const deps = createMockDeps([
      {
        markdownContent: MOCK_REPORT_CONTENT,
        overallScore: "6.0-6.5",
        overallVerdict: "proceed_with_caution",
      },
    ]);

    const context = createFullContext();
    const result = await invokeActor(synthesizeReport, { context, deps });

    expect(result.report.markdownContent).toBe(MOCK_REPORT_CONTENT);
    expect(result.report.overallScore).toBe("6.0-6.5");
    expect(result.report.overallVerdict).toBe("proceed_with_caution");
    expect(result.report.charCount).toBeGreaterThan(0);
    expect(result.report.sourceCount).toBe(3);
    expect(result.selfCheck.passed).toBe(true);
    expect(result.usage).toBeDefined();
  });

  it("fails self-check when report is missing required sections", async () => {
    const incompleteReport = "# Report\n\nJust some text without proper structure.";

    const deps = createMockDeps([
      {
        markdownContent: incompleteReport,
        overallScore: "5.0-5.5",
        overallVerdict: "hold",
      },
    ]);

    const context = createFullContext();
    const result = await invokeActor(synthesizeReport, { context, deps });

    expect(result.selfCheck.passed).toBe(false);
    expect(result.selfCheck.failedChecks.length).toBeGreaterThan(0);
  });

  it("computes correct char count and source count", async () => {
    const deps = createMockDeps([
      {
        markdownContent: MOCK_REPORT_CONTENT,
        overallScore: "7.0-7.5",
        overallVerdict: "proceed",
      },
    ]);

    const context = createFullContext();
    const result = await invokeActor(synthesizeReport, { context, deps });

    expect(result.report.charCount).toBe(MOCK_REPORT_CONTENT.length);
    expect(result.report.sourceCount).toBe(context.evidence.length);
  });
});

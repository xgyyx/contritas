import { describe, it, expect, vi } from "vitest";
import { createActor, toPromise } from "xstate";
import { crossValidate } from "../actors/cross-validate.js";
import type { ResearchContext, WorkflowDeps, EvidenceData } from "../types.js";
import { MockProvider } from "@contritas/llm";

function createMockDeps(responses: unknown[]): WorkflowDeps {
  const provider = new MockProvider({ structuredResponses: responses });
  return {
    llmProvider: provider,
    getModelForPhase: () => "mock-model",
    emitEvent: vi.fn(),
    persistState: vi.fn().mockResolvedValue(undefined),
  };
}

function createContextWithEvidence(evidence: EvidenceData[]): ResearchContext {
  return {
    sessionId: "test-session",
    input: {
      originalText: "Test proposition",
      validatedProposition: "Validated test proposition",
      language: "zh",
    },
    assumptions: [],
    dimensions: [],
    evidence,
    crossValidations: [],
    phases: [],
    currentPhase: "validation",
    clarificationHistory: [],
    tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCostUSD: 0 },
    searchCallsUsed: 10,
    selfCheckRetries: 0,
  };
}

/** Run a fromPromise actor to completion using XState's public API. */
function invokeActor(actor: any, input: any): Promise<any> {
  const a = createActor(actor, { input });
  a.start();
  return toPromise(a);
}

describe("Cross-Validate Actor", () => {
  it("returns consistent validation for agreeing evidence", async () => {
    const evidence: EvidenceData[] = [
      {
        id: "e1",
        dimensionId: "dim-1",
        url: "https://a.com",
        title: "A",
        sourceName: "Source A",
        sourceType: "official_doc",
        credibility: "high",
        language: "zh",
        keyExcerpt: "Supporting data",
        relationship: "supports",
        timelinessRisk: false,
        searchQuery: "q1",
        searchRound: 1,
      },
      {
        id: "e2",
        dimensionId: "dim-1",
        url: "https://b.com",
        title: "B",
        sourceName: "Source B",
        sourceType: "statistics",
        credibility: "high",
        language: "en",
        keyExcerpt: "Also supporting",
        relationship: "supports",
        timelinessRisk: false,
        searchQuery: "q2",
        searchRound: 1,
      },
    ];

    const deps = createMockDeps([
      {
        validations: [
          {
            dimensionId: "dim-1",
            consistent: true,
            verdict: "supported",
            confidence: "high",
            evidenceIds: ["e1", "e2"],
          },
        ],
      },
    ]);

    const context = createContextWithEvidence(evidence);
    const result = await invokeActor(crossValidate as any, { context, deps });

    expect(result.crossValidations).toHaveLength(1);
    expect(result.crossValidations[0].consistent).toBe(true);
    expect(result.crossValidations[0].verdict).toBe("supported");
    expect(result.crossValidations[0].confidence).toBe("high");
    expect(result.usage).toBeDefined();
  });

  it("returns inconsistent validation for contradictory evidence", async () => {
    const evidence: EvidenceData[] = [
      {
        id: "e1",
        dimensionId: "dim-2",
        url: "https://a.com",
        title: "A",
        sourceName: "Gov Report",
        sourceType: "official_doc",
        credibility: "high",
        language: "zh",
        keyExcerpt: "Market is growing 30%",
        relationship: "supports",
        timelinessRisk: false,
        searchQuery: "q1",
        searchRound: 1,
      },
      {
        id: "e2",
        dimensionId: "dim-2",
        url: "https://b.com",
        title: "B",
        sourceName: "Analyst",
        sourceType: "industry_report",
        credibility: "medium",
        language: "en",
        keyExcerpt: "Market is saturated",
        relationship: "weakens",
        timelinessRisk: false,
        searchQuery: "q2",
        searchRound: 2,
      },
    ];

    const deps = createMockDeps([
      {
        validations: [
          {
            dimensionId: "dim-2",
            consistent: false,
            contradictionDescription: "Government data shows growth but analyst reports saturation",
            contradictionReason: "time_difference",
            verdict: "disputed",
            confidence: "medium",
            evidenceIds: ["e1", "e2"],
          },
        ],
      },
    ]);

    const context = createContextWithEvidence(evidence);
    const result = await invokeActor(crossValidate as any, { context, deps });

    expect(result.crossValidations).toHaveLength(1);
    expect(result.crossValidations[0].consistent).toBe(false);
    expect(result.crossValidations[0].contradictionDescription).toBeTruthy();
    expect(result.crossValidations[0].contradictionReason).toBe("time_difference");
    expect(result.crossValidations[0].verdict).toBe("disputed");
  });

  it("handles multiple dimensions", async () => {
    const evidence: EvidenceData[] = [
      {
        id: "ea-1",
        dimensionId: "dim-a",
        url: "https://a.com",
        title: "A",
        sourceName: "Source A",
        sourceType: "official_doc",
        credibility: "high",
        language: "zh",
        keyExcerpt: "Data A",
        relationship: "supports",
        timelinessRisk: false,
        searchQuery: "q1",
        searchRound: 1,
      },
      {
        id: "eb-1",
        dimensionId: "dim-b",
        url: "https://b.com",
        title: "B",
        sourceName: "Source B",
        sourceType: "media",
        credibility: "low",
        language: "en",
        keyExcerpt: "Data B",
        relationship: "qualifies",
        timelinessRisk: true,
        searchQuery: "q2",
        searchRound: 1,
      },
    ];

    const deps = createMockDeps([
      {
        validations: [
          {
            dimensionId: "dim-a",
            consistent: true,
            verdict: "supported",
            confidence: "high",
            evidenceIds: ["e1"],
          },
          {
            dimensionId: "dim-b",
            consistent: true,
            verdict: "unsupported",
            confidence: "low",
            evidenceIds: ["e2"],
          },
        ],
      },
    ]);

    const context = createContextWithEvidence(evidence);
    const result = await invokeActor(crossValidate as any, { context, deps });

    expect(result.crossValidations).toHaveLength(2);
    expect(result.crossValidations[0].dimensionId).toBe("dim-a");
    expect(result.crossValidations[1].dimensionId).toBe("dim-b");
  });
});

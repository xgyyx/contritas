import { describe, it, expect, vi } from "vitest";
import { createActor, toPromise } from "xstate";
import { MockProvider } from "@contritas/llm";
import { plan } from "../actors/plan.js";
import type { ResearchContext, WorkflowDeps } from "../types.js";

function createMockDeps(responses: unknown[]): {
  deps: WorkflowDeps;
  provider: MockProvider;
} {
  const provider = new MockProvider({ structuredResponses: responses });
  return {
    provider,
    deps: {
      llmProvider: provider,
      getModelForPhase: () => "mock-model",
      emitEvent: vi.fn(),
      persistState: vi.fn().mockResolvedValue(undefined),
    },
  };
}

function createContext(
  assumptions: ResearchContext["assumptions"]
): ResearchContext {
  return {
    sessionId: "s1",
    input: {
      originalText: "Test",
      validatedProposition: "Validated test proposition",
      language: "en",
    },
    assumptions,
    dimensions: [],
    evidence: [],
    crossValidations: [],
    phases: [],
    currentPhase: "planning",
    clarificationHistory: [],
    tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCostUSD: 0 },
    searchCallsUsed: 0,
    selfCheckRetries: 0,
  };
}

function invokeActor(actor: any, input: any): Promise<any> {
  const a = createActor(actor, { input });
  a.start();
  return toPromise(a);
}

const validDimension = {
  name: "Performance",
  coreQuestion: "Does Rust outperform Go?",
  counterQuestion: "Are gains illusory in practice?",
  keywords: { zh: ["性能"], en: ["performance"] },
  relatedAssumptionIndices: [0],
};

describe("Plan Actor", () => {
  it("returns dimensions with bilingual keywords + complexity + estimatedMinutes", async () => {
    const { deps } = createMockDeps([
      {
        dimensions: [validDimension, { ...validDimension, name: "Ecosystem" }],
        complexity: "medium",
        estimatedMinutes: 25,
      },
    ]);

    const ctx = createContext([
      { id: "a1", content: "x", type: "factual", importance: "high", order: 1 },
    ]);
    const result = await invokeActor(plan, { context: ctx, deps });

    expect(result.dimensions).toHaveLength(2);
    expect(result.dimensions[0].keywords.zh).toEqual(["性能"]);
    expect(result.dimensions[0].keywords.en).toEqual(["performance"]);
    expect(result.complexity).toBe("medium");
    expect(result.estimatedMinutes).toBe(25);
  });

  it("includes assumption list in user message so LLM can map dimensions back", async () => {
    const { deps, provider } = createMockDeps([
      { dimensions: [validDimension], complexity: "low", estimatedMinutes: 10 },
    ]);

    const ctx = createContext([
      { id: "a1", content: "Rust is fast", type: "factual", importance: "high", order: 1 },
      { id: "a2", content: "Team can learn", type: "judgmental", importance: "medium", order: 2 },
    ]);

    await invokeActor(plan, { context: ctx, deps });

    const last = provider.getCalls().at(-1);
    const content = (last as any).params.messages[0].content as string;
    expect(content).toContain("Validated test proposition");
    expect(content).toContain("1. [factual, high] Rust is fast");
    expect(content).toContain("2. [judgmental, medium] Team can learn");
  });

  it("rejects unknown complexity values", async () => {
    const { deps } = createMockDeps([
      {
        dimensions: [validDimension],
        complexity: "extreme",
        estimatedMinutes: 100,
      },
    ]);

    await expect(
      invokeActor(plan, { context: createContext([]), deps })
    ).rejects.toThrow();
  });

  it("accepts a single-dimension plan (boundary case for low complexity)", async () => {
    const { deps } = createMockDeps([
      { dimensions: [validDimension], complexity: "low", estimatedMinutes: 8 },
    ]);

    const result = await invokeActor(plan, { context: createContext([]), deps });

    expect(result.dimensions).toHaveLength(1);
    expect(result.complexity).toBe("low");
  });
});

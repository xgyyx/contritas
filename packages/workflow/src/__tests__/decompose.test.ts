import { describe, it, expect, vi } from "vitest";
import { createActor, toPromise } from "xstate";
import { MockProvider } from "@contritas/llm";
import { decompose } from "../actors/decompose.js";
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
  validatedProposition: string | undefined,
  originalText = "Original text"
): ResearchContext {
  return {
    sessionId: "s1",
    input: {
      originalText,
      validatedProposition,
      language: "zh",
    },
    assumptions: [],
    dimensions: [],
    evidence: [],
    crossValidations: [],
    phases: [],
    currentPhase: "decomposition",
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

describe("Decompose Actor", () => {
  it("returns assumptions with all required fields", async () => {
    const { deps } = createMockDeps([
      {
        assumptions: [
          { content: "A is true", type: "factual", importance: "high", order: 1 },
          { content: "B is reasonable", type: "judgmental", importance: "medium", order: 2 },
          { content: "C might hold", type: "judgmental", importance: "low", order: 3 },
        ],
      },
    ]);

    const result = await invokeActor(
      decompose,
{ context: createContext("Test proposition"), deps }
    );

    expect(result.assumptions).toHaveLength(3);
    expect(result.assumptions[0].type).toBe("factual");
    expect(result.assumptions[0].importance).toBe("high");
    expect(result.assumptions[2].importance).toBe("low");
    expect(result.usage).toBeDefined();
  });

  it("uses validatedProposition when set, falls back to originalText otherwise", async () => {
    const { deps: deps1, provider: p1 } = createMockDeps([
      { assumptions: [{ content: "x", type: "factual", importance: "high", order: 1 }] },
    ]);
    await invokeActor(
      decompose,
{ context: createContext("Validated form", "Raw text"), deps: deps1 }
    );
    const call1 = p1.getCalls().at(-1);
    expect((call1 as any).params.messages[0].content).toContain("Validated form");
    expect((call1 as any).params.messages[0].content).not.toContain("Raw text");

    const { deps: deps2, provider: p2 } = createMockDeps([
      { assumptions: [{ content: "x", type: "factual", importance: "high", order: 1 }] },
    ]);
    await invokeActor(
      decompose,
{ context: createContext(undefined, "Raw text only"), deps: deps2 }
    );
    const call2 = p2.getCalls().at(-1);
    expect((call2 as any).params.messages[0].content).toContain("Raw text only");
  });

  it("rejects when LLM returns malformed assumption (schema violation)", async () => {
    const { deps } = createMockDeps([
      {
        assumptions: [
          { content: "Missing fields", type: "unknown_type", importance: "high", order: 1 },
        ],
      },
    ]);

    await expect(
      invokeActor(decompose, { context: createContext("Test"), deps })
    ).rejects.toThrow();
  });

  it("accepts an empty assumptions array (boundary case)", async () => {
    const { deps } = createMockDeps([{ assumptions: [] }]);
    const result = await invokeActor(
      decompose,
{ context: createContext("Test"), deps }
    );
    expect(result.assumptions).toHaveLength(0);
  });
});

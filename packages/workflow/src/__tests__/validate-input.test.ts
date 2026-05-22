import { describe, it, expect, vi } from "vitest";
import { createActor, toPromise } from "xstate";
import { MockProvider } from "@contritas/llm";
import { validateInput } from "../actors/validate-input.js";
import type {
  ResearchContext,
  WorkflowDeps,
  ValidateInputResult,
} from "../types.js";

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
  originalText: string,
  clarificationHistory: ResearchContext["clarificationHistory"] = []
): ResearchContext {
  return {
    sessionId: "s1",
    input: { originalText, language: "zh" },
    assumptions: [],
    dimensions: [],
    evidence: [],
    crossValidations: [],
    phases: [],
    currentPhase: "inputValidation",
    clarificationHistory,
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

describe("Validate Input Actor", () => {
  it("returns valid=true with cleaned proposition for a clear research claim", async () => {
    const { deps } = createMockDeps([
      {
        valid: true,
        validatedProposition: "Rust 比 Go 更适合高并发 Web 服务",
        detectedLanguage: "zh",
      },
    ]);

    const result: ValidateInputResult = await invokeActor(validateInput, {
      context: createContext("Rust 比 Go 更适合高并发 Web 服务"),
      deps,
    });

    expect(result.valid).toBe(true);
    expect(result.output.validatedProposition).toBe("Rust 比 Go 更适合高并发 Web 服务");
    expect(result.output.detectedLanguage).toBe("zh");
  });

  it("returns valid=false with clarification questions for vague input", async () => {
    const { deps } = createMockDeps([
      {
        valid: false,
        reason: "Input is too vague",
        clarificationQuestions: ["What aspect of AI?", "Time horizon?"],
        suggestedDirections: ["Focus on LLM agents in 2026"],
        detectedLanguage: "zh",
      },
    ]);

    const result: ValidateInputResult = await invokeActor(validateInput, {
      context: createContext("帮我研究一下AI"),
      deps,
    });

    expect(result.valid).toBe(false);
    expect(result.output.clarificationQuestions).toHaveLength(2);
    expect(result.output.suggestedDirections).toHaveLength(1);
  });

  it("incorporates the latest clarification response into the user message", async () => {
    const { deps, provider } = createMockDeps([
      {
        valid: true,
        validatedProposition: "Refined proposition with clarification",
        detectedLanguage: "en",
      },
    ]);

    const ctx = createContext("Original vague text", [
      {
        questions: ["Be specific?"],
        userResponse: "Specifically, focus on Rust web frameworks",
        timestamp: new Date().toISOString(),
      },
    ]);

    await invokeActor(validateInput, { context: ctx, deps });

    const lastCall = provider.getCalls().at(-1);
    expect(lastCall).toBeDefined();
    const userContent = (lastCall as any).params.messages[0].content as string;
    expect(userContent).toContain("Original vague text");
    expect(userContent).toContain("Specifically, focus on Rust web frameworks");
    // Both untrusted segments must be wrapped in external_content sentinels.
    expect(userContent).toMatch(/<external_content[^>]*kind="user-proposition"/);
    expect(userContent).toMatch(/<external_content[^>]*kind="user-clarification"/);
  });

  it("propagates LLM provider errors", async () => {
    const provider = new MockProvider({ structuredResponses: [] });
    const deps: WorkflowDeps = {
      llmProvider: provider,
      getModelForPhase: () => "mock-model",
      emitEvent: vi.fn(),
      persistState: vi.fn().mockResolvedValue(undefined),
    };

    await expect(
      invokeActor(validateInput, { context: createContext("Anything"), deps })
    ).rejects.toThrow(/No structured response configured/);
  });
});

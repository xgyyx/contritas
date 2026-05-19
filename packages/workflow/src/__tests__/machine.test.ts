import { describe, it, expect, vi } from "vitest";
import { createActor } from "xstate";
import { createResearchMachine } from "../machine.js";
import type { ResearchContext, WorkflowDeps } from "../types.js";
import { MockProvider } from "@contritas/llm";

function createTestDeps(mockProvider?: MockProvider): WorkflowDeps {
  const provider = mockProvider ?? new MockProvider({
    structuredResponses: [
      // Phase 0: valid input
      {
        valid: true,
        validatedProposition: "Rust比Go更适合构建高并发Web服务",
        detectedLanguage: "zh",
      },
      // Phase 1: decomposition
      {
        assumptions: [
          { content: "Rust has mature web frameworks", type: "factual", importance: "high", order: 1 },
          { content: "Performance difference matters", type: "judgmental", importance: "medium", order: 2 },
        ],
      },
      // Phase 2: planning
      {
        dimensions: [
          {
            name: "技术生态",
            coreQuestion: "Rust生态是否支持生产级Web开发?",
            counterQuestion: "Rust生态不足以支撑复杂Web服务?",
            keywords: { zh: ["Rust Web框架"], en: ["Rust web framework"] },
            relatedAssumptionIndices: [0],
          },
        ],
        complexity: "medium",
        estimatedMinutes: 20,
      },
    ],
  });

  return {
    llmProvider: provider,
    llmModel: "mock-model",
    emitEvent: vi.fn(),
    persistState: vi.fn().mockResolvedValue(undefined),
  };
}

function createTestContext(): ResearchContext {
  return {
    sessionId: "test-session-001",
    input: {
      originalText: "Rust比Go更适合构建高并发Web服务",
      language: "zh",
    },
    assumptions: [],
    dimensions: [],
    evidence: [],
    crossValidations: [],
    phases: [],
    currentPhase: "inputValidation",
    clarificationHistory: [],
    tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCostUSD: 0 },
    searchCallsUsed: 0,
    selfCheckRetries: 0,
  };
}

describe("Research Machine", () => {
  it("transitions through all phases with valid input", async () => {
    const deps = createTestDeps();
    const machine = createResearchMachine(deps);
    const context = createTestContext();

    const result = await new Promise<string>((resolve) => {
      const actor = createActor(machine, { input: context });
      actor.subscribe({
        complete: () => {
          resolve(actor.getSnapshot().value as string);
        },
      });
      actor.start();
    });

    // Without searchDeps configured, retrieval phase will fail
    // The machine ends in "failed" because searchDimensions actor throws
    expect(result).toBe("failed");
    expect(deps.emitEvent).toHaveBeenCalled();
    expect(deps.persistState).toHaveBeenCalled();
  });

  it("enters awaitingClarification with invalid input", async () => {
    const provider = new MockProvider({
      structuredResponses: [
        // Phase 0: needs clarification
        {
          valid: false,
          reason: "Too vague",
          clarificationQuestions: ["What specific aspect do you want to research?"],
          suggestedDirections: ["Try narrowing down to a specific market"],
          detectedLanguage: "zh",
        },
      ],
    });

    const deps = createTestDeps(provider);
    const machine = createResearchMachine(deps);
    const context = createTestContext();
    context.input.originalText = "帮我研究一下AI";

    const actor = createActor(machine, { input: context });
    actor.start();

    // Wait a tick for the invoke to complete
    await new Promise((r) => setTimeout(r, 50));

    expect(actor.getSnapshot().value).toBe("awaitingClarification");
  });

  it("re-enters validation after user response", async () => {
    const provider = new MockProvider({
      structuredResponses: [
        // First call: needs clarification
        {
          valid: false,
          reason: "Too vague",
          clarificationQuestions: ["What aspect?"],
          detectedLanguage: "zh",
        },
        // Second call after user response: valid
        {
          valid: true,
          validatedProposition: "AI Agent赛道2026年是否值得创业",
          detectedLanguage: "zh",
        },
        // Phase 1: decomposition
        {
          assumptions: [
            { content: "AI Agent market is growing", type: "factual", importance: "high", order: 1 },
          ],
        },
        // Phase 2: planning
        {
          dimensions: [
            {
              name: "市场规模",
              coreQuestion: "AI Agent市场有多大?",
              counterQuestion: "市场是否已经饱和?",
              keywords: { zh: ["AI Agent市场"], en: ["AI agent market"] },
              relatedAssumptionIndices: [0],
            },
          ],
          complexity: "low",
          estimatedMinutes: 10,
        },
      ],
    });

    const deps = createTestDeps(provider);
    const machine = createResearchMachine(deps);
    const context = createTestContext();
    context.input.originalText = "帮我研究一下AI";

    const result = await new Promise<string>((resolve) => {
      const actor = createActor(machine, { input: context });

      // After entering awaitingClarification, send user response
      actor.subscribe((snapshot) => {
        if (snapshot.value === "awaitingClarification") {
          setTimeout(() => {
            actor.send({ type: "USER_RESPONSE", response: "我想验证AI Agent赛道2026年是否值得创业" });
          }, 10);
        }
      });

      actor.subscribe({
        complete: () => {
          resolve(actor.getSnapshot().value as string);
        },
      });

      actor.start();
    });

    expect(result).toBe("failed");
  });

  it("transitions to cancelled on CANCEL event", async () => {
    const provider = new MockProvider({
      structuredResponses: [
        {
          valid: false,
          reason: "Too vague",
          clarificationQuestions: ["What?"],
          detectedLanguage: "zh",
        },
      ],
    });

    const deps = createTestDeps(provider);
    const machine = createResearchMachine(deps);
    const context = createTestContext();

    const result = await new Promise<string>((resolve) => {
      const actor = createActor(machine, { input: context });

      actor.subscribe((snapshot) => {
        if (snapshot.value === "awaitingClarification") {
          setTimeout(() => {
            actor.send({ type: "CANCEL" });
          }, 10);
        }
      });

      actor.subscribe({
        complete: () => {
          resolve(actor.getSnapshot().value as string);
        },
      });

      actor.start();
    });

    expect(result).toBe("cancelled");
  });

  it("transitions to failed when LLM errors", async () => {
    const provider = new MockProvider({
      structuredResponses: [], // No responses configured — will throw
    });

    const deps = createTestDeps(provider);
    const machine = createResearchMachine(deps);
    const context = createTestContext();

    const result = await new Promise<string>((resolve) => {
      const actor = createActor(machine, { input: context });
      actor.subscribe({
        complete: () => {
          resolve(actor.getSnapshot().value as string);
        },
      });
      actor.start();
    });

    expect(result).toBe("failed");
  });
});

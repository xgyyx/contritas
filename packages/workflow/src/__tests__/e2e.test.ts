import { describe, it, expect, vi } from "vitest";
import { createActor } from "xstate";
import { MockProvider } from "@contritas/llm";
import { generateId } from "@contritas/shared";
import type {
  SearchProvider,
  ContentExtractor,
  SearchResult,
  ExtractedContent,
} from "@contritas/search";
import { createResearchMachine } from "../machine.js";
import type {
  ResearchContext,
  WorkflowDeps,
  SearchDeps,
} from "../types.js";

// ──────────────────────────────────────────────────────────────────────────────
// Memory search/extractor doubles. Using these instead of real API providers
// keeps the workflow under test free of network I/O and deterministic.
// ──────────────────────────────────────────────────────────────────────────────

class MemorySearchProvider implements SearchProvider {
  readonly name = "memory";
  constructor(private readonly results: SearchResult[]) {}
  async search(): Promise<SearchResult[]> {
    return this.results;
  }
}

class MemoryExtractor implements ContentExtractor {
  readonly name = "memory";
  constructor(private readonly contents: Map<string, ExtractedContent>) {}
  async extract(url: string): Promise<ExtractedContent> {
    return (
      this.contents.get(url) ?? {
        url,
        title: "Stub",
        content: "Stub content",
        wordCount: 2,
        success: true,
      }
    );
  }
}

function buildSearchDeps(): SearchDeps {
  const dim1Results: SearchResult[] = Array.from({ length: 4 }).map((_, i) => ({
    url: `https://example.com/dim1/${i}`,
    title: `Dim1 result ${i}`,
    snippet: `Snippet ${i}`,
  }));
  const contents = new Map<string, ExtractedContent>(
    dim1Results.map((r, i) => [
      r.url,
      {
        url: r.url,
        title: r.title,
        content: `Content for ${r.url} — paragraph ${i}. `.repeat(20),
        wordCount: 200,
        success: true,
      } as ExtractedContent,
    ])
  );
  return {
    searchProvider: new MemorySearchProvider(dim1Results),
    contentExtractor: new MemoryExtractor(contents),
    searchConcurrencyLimit: 2,
    extractConcurrencyLimit: 2,
    maxSearchCallsPerSession: 50,
  };
}

function buildLLMResponses() {
  // Pre-compute stable evidence ids that will be assigned by the workflow during
  // search. Cross-validate consumes them by url-based reference, so we use the
  // first 3 result urls.
  return [
    // Phase 0: validate input
    {
      valid: true,
      validatedProposition: "Should we adopt Rust for backend services?",
      detectedLanguage: "en",
    },
    // Phase 1: decompose assumptions (with stable ids so persistence aligns)
    {
      assumptions: [
        { id: "as_1", content: "Rust delivers measurable perf wins", type: "factual", importance: "high", order: 1 },
        { id: "as_2", content: "Team can ramp on Rust quickly", type: "judgmental", importance: "medium", order: 2 },
      ],
    },
    // Phase 2: plan dimensions (single dimension to keep e2e small but full)
    {
      dimensions: [
        {
          id: "dim_1",
          name: "Performance vs current stack",
          coreQuestion: "Does Rust beat our current backend in real workloads?",
          counterQuestion: "Are reported gains illusory or workload-specific?",
          keywords: { zh: ["Rust 性能"], en: ["Rust performance backend"] },
          relatedAssumptionIndices: [0],
        },
      ],
      complexity: "medium",
      estimatedMinutes: 15,
    },
    // Phase 3: evidence evaluation. The orchestrator may issue multiple
    // batches per round (zh + en queries return overlapping URLs that fan out
    // into multiple batches before dedup). We supply two batch responses so
    // the mock provider doesn't run out before cross-validation.
    {
      evaluations: Array.from({ length: 4 }).map((_, i) => ({
        url: `https://example.com/dim1/${i}`,
        relevant: true,
        sourceType: "industry_report",
        credibility: "high",
        relationship: "supports",
        keyExcerpt: `Excerpt for url ${i}`,
        publishedDate: "2025-09-01",
        timelinessRisk: false,
        sourceName: `Source ${i}`,
      })),
    },
    // Second evaluation batch (overlapping urls — orchestrator dedups).
    {
      evaluations: Array.from({ length: 3 }).map((_, i) => ({
        url: `https://example.com/dim1/${i}`,
        relevant: true,
        sourceType: "industry_report",
        credibility: "high",
        relationship: "supports",
        keyExcerpt: `Excerpt for url ${i} (batch 2)`,
        publishedDate: "2025-09-01",
        timelinessRisk: false,
        sourceName: `Source ${i}`,
      })),
    },
    // Phase 4: cross-validate. evidenceIds is informational; consistent verdict.
    {
      validations: [
        {
          dimensionId: "dim_1",
          consistent: true,
          verdict: "supported",
          confidence: "high",
          evidenceIds: ["e_1", "e_2", "e_3"],
        },
      ],
    },
    // Phase 5: synthesize report. Hand-crafted markdown that satisfies the four
    // self-checks (counter question, source table with rows, overall
    // assessment with score reasoning).
    {
      markdownContent: [
        "# Report",
        "",
        "## 一、概述",
        "Adoption study.",
        "",
        "## Dimension: Performance vs current stack",
        "### Counter Question",
        "Are reported gains illusory or workload-specific?",
        "Evidence: refs [1][2][3][4].",
        "",
        "## 六、综合评估",
        "评分说明：we rate this 6.0 because evidence is consistent though sample is small.",
        "为什么不是更高: limited longitudinal data.",
        "为什么不是更低: independent reports converge.",
        "",
        "## 八、参考来源",
        "| # | Source | URL |",
        "| - | ------ | --- |",
        "| 1 | Source 0 | https://example.com/dim1/0 |",
        "| 2 | Source 1 | https://example.com/dim1/1 |",
        "| 3 | Source 2 | https://example.com/dim1/2 |",
        "| 4 | Source 3 | https://example.com/dim1/3 |",
      ].join("\n"),
      overallScore: "6.0-6.5",
      overallVerdict: "proceed_with_caution",
    },
  ];
}

function createInitialContext(): ResearchContext {
  return {
    sessionId: generateId(),
    input: { originalText: "Should we adopt Rust for backend services?", language: "en" },
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

function createDeps(provider: MockProvider): WorkflowDeps {
  return {
    llmProvider: provider,
    getModelForPhase: () => "mock-model",
    searchDeps: buildSearchDeps(),
    emitEvent: vi.fn(),
    persistState: vi.fn().mockResolvedValue(undefined),
  };
}

describe("workflow e2e (mock LLM + memory search)", () => {
  it("runs end-to-end: validate → decompose → plan → search → cross-validate → synthesize", async () => {
    const provider = new MockProvider({ structuredResponses: buildLLMResponses() });
    const deps = createDeps(provider);
    const machine = createResearchMachine(deps);
    const context = createInitialContext();

    const finalState = await new Promise<{ state: string; ctx: ResearchContext }>((resolve) => {
      const actor = createActor(machine, { input: context });
      actor.subscribe({
        complete: () => {
          const snap = actor.getSnapshot();
          resolve({ state: snap.value as string, ctx: snap.context });
        },
      });
      actor.start();
    });

    expect(finalState.state).toBe("completed");
    expect(finalState.ctx.assumptions.length).toBe(2);
    expect(finalState.ctx.dimensions.length).toBe(1);
    expect(finalState.ctx.evidence.length).toBeGreaterThanOrEqual(3);
    expect(finalState.ctx.crossValidations.length).toBe(1);
    expect(finalState.ctx.report).toBeDefined();
    expect(finalState.ctx.report?.overallVerdict).toBe("proceed_with_caution");
    // persistState fires once per completed phase (including synthesis).
    expect(deps.persistState).toHaveBeenCalled();
    // emitEvent fires phase_change/eta_update/etc throughout.
    expect((deps.emitEvent as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(5);
  }, 15_000);
});

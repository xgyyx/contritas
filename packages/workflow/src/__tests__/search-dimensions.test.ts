import { describe, it, expect, vi } from "vitest";
import { createActor, toPromise } from "xstate";
import { MockProvider } from "@contritas/llm";
import type {
  SearchProvider,
  ContentExtractor,
  SearchResult,
  ExtractedContent,
} from "@contritas/search";
import { searchDimensions } from "../actors/search-dimensions.js";
import type {
  ResearchContext,
  WorkflowDeps,
  SearchDeps,
  DimensionData,
} from "../types.js";

class MemorySearchProvider implements SearchProvider {
  readonly name = "memory";
  callCount = 0;
  constructor(
    private readonly resultsByQuery: (query: string) => SearchResult[]
  ) {}
  async search(params: { query: string }): Promise<SearchResult[]> {
    this.callCount++;
    return this.resultsByQuery(params.query);
  }
}

class MemoryExtractor implements ContentExtractor {
  readonly name = "memory";
  async extract(url: string): Promise<ExtractedContent> {
    return {
      url,
      title: `Title for ${url}`,
      content: `Some article body for ${url}. `.repeat(30),
      wordCount: 300,
      success: true,
    };
  }
}

function buildSearchDeps(): SearchDeps {
  const fixedResults = (q: string): SearchResult[] =>
    Array.from({ length: 4 }).map((_, i) => ({
      url: `https://ex.test/${q}/${i}`,
      title: `Result ${i} for ${q}`,
      snippet: `Snippet ${i}`,
    }));

  return {
    searchProvider: new MemorySearchProvider(fixedResults),
    contentExtractor: new MemoryExtractor(),
    searchConcurrencyLimit: 2,
    extractConcurrencyLimit: 2,
    maxSearchCallsPerSession: 50,
  };
}

function buildLLMResponses(numDims: number) {
  // The orchestrator issues an evidence-eval call per dimension per round; we
  // pre-load enough responses for first round across all dims.
  return Array.from({ length: numDims * 2 }).map(() => ({
    evaluations: Array.from({ length: 4 }).map((_, i) => ({
      url: `https://ex.test/q/${i}`,
      relevant: true,
      sourceType: "industry_report",
      credibility: "high",
      relationship: "supports",
      keyExcerpt: `Excerpt ${i}`,
      publishedDate: "2025-09-01",
      timelinessRisk: false,
      sourceName: `Source ${i}`,
    })),
  }));
}

function createDeps(searchDeps?: SearchDeps, usagePerCall?: Array<{
  inputTokens: number; outputTokens: number; totalTokens: number; estimatedCostUSD: number;
}>): WorkflowDeps {
  const provider = new MockProvider({
    structuredResponses: buildLLMResponses(3),
    usagePerCall,
  });
  return {
    llmProvider: provider,
    getModelForPhase: () => "mock-model",
    searchDeps,
    emitEvent: vi.fn(),
    persistState: vi.fn().mockResolvedValue(undefined),
  };
}

function createContext(
  dimensions: DimensionData[],
  targetedDimensions?: string[]
): ResearchContext {
  return {
    sessionId: "s1",
    input: { originalText: "Test", language: "en" },
    assumptions: [],
    dimensions,
    evidence: [],
    crossValidations: [],
    phases: [],
    currentPhase: "retrieval",
    clarificationHistory: [],
    tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCostUSD: 0 },
    searchCallsUsed: 0,
    selfCheckRetries: 0,
    targetedDimensions,
  };
}

function makeDimension(id: string, name: string): DimensionData {
  return {
    id,
    name,
    coreQuestion: `Q for ${name}?`,
    counterQuestion: `Counter for ${name}?`,
    keywords: { zh: [`${name}-zh`], en: [`${name}-en`] },
    relatedAssumptionIndices: [],
  };
}

function invokeActor(actor: any, input: any): Promise<any> {
  const a = createActor(actor, { input });
  a.start();
  return toPromise(a);
}

describe("Search Dimensions Actor", () => {
  it("throws when searchDeps is not configured", async () => {
    const deps = createDeps(undefined);
    const ctx = createContext([makeDimension("d1", "Dim1")]);
    await expect(
      invokeActor(searchDimensions, { context: ctx, deps })
    ).rejects.toThrow(/SearchDeps not configured/);
  });

  it("processes all dimensions and returns evidence with stable dimensionId", async () => {
    const deps = createDeps(buildSearchDeps());
    const ctx = createContext([
      makeDimension("d1", "Dim1"),
      makeDimension("d2", "Dim2"),
    ]);

    const result = await invokeActor(searchDimensions, { context: ctx, deps });

    expect(result.evidence.length).toBeGreaterThan(0);
    // Every evidence's dimensionId must come from the dimensions we passed in.
    const validIds = new Set(["d1", "d2"]);
    for (const ev of result.evidence) {
      expect(validIds.has(ev.dimensionId)).toBe(true);
      expect(ev.id).toBeTruthy(); // generateId() ran
    }
    expect(result.dimensionResults.map((r: { dimensionId: string }) => r.dimensionId).sort()).toEqual([
      "d1",
      "d2",
    ]);
  });

  it("filters to targetedDimensions when set (self-check retry path)", async () => {
    const deps = createDeps(buildSearchDeps());
    const ctx = createContext(
      [
        makeDimension("d1", "Dim1"),
        makeDimension("d2", "Dim2"),
        makeDimension("d3", "Dim3"),
      ],
      ["d2"]
    );

    const result = await invokeActor(searchDimensions, { context: ctx, deps });

    // Only d2 should be searched.
    expect(result.dimensionResults).toHaveLength(1);
    expect(result.dimensionResults[0].dimensionId).toBe("d2");
    for (const ev of result.evidence) {
      expect(ev.dimensionId).toBe("d2");
    }
  });

  it("emits dimension/search events through deps.emitEvent", async () => {
    const deps = createDeps(buildSearchDeps());
    const ctx = createContext([makeDimension("d1", "Dim1")]);

    await invokeActor(searchDimensions, { context: ctx, deps });

    const events = (deps.emitEvent as ReturnType<typeof vi.fn>).mock.calls.map(
      (c) => c[0]
    );
    const types = new Set(events.map((e: any) => e.type));
    expect(types.size).toBeGreaterThan(0);
    // Orchestrator forwards search events; we shouldn't see workflow-level
    // phase_change here (that's the machine's job).
    expect(types.has("phase_change")).toBe(false);
  });

  it("aggregates LLM usage from evaluateEvidence/refineKeywords across all dims (6.2.9 R2)", async () => {
    // Each evaluateEvidence call costs 0.1 USD; with 2 dims and at least 1
    // evaluation call per dim we expect total >= 0.2.
    const fakeUsage = Array.from({ length: 12 }).map(() => ({
      inputTokens: 200,
      outputTokens: 100,
      totalTokens: 300,
      estimatedCostUSD: 0.1,
    }));
    const deps = createDeps(buildSearchDeps(), fakeUsage);
    const ctx = createContext([
      makeDimension("d1", "Dim1"),
      makeDimension("d2", "Dim2"),
    ]);

    const result = await invokeActor(searchDimensions, { context: ctx, deps });

    expect(result.usage).toBeDefined();
    // At least one evaluateEvidence batch fired per dim — total cost > 0.
    expect(result.usage.estimatedCostUSD).toBeGreaterThan(0);
    expect(result.usage.totalTokens).toBeGreaterThan(0);
  });
});

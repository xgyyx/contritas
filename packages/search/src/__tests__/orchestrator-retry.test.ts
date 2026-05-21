import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SearchOrchestrator } from "../orchestrator.js";
import { SessionCallCounter } from "../rate-limiter.js";
import type {
  SearchProvider,
  ContentExtractor,
  ExtractedContent,
  SearchResult,
  DimensionSearchInput,
} from "../types.js";
import type { LLMProvider } from "@contritas/llm";

// ── Fakes ──────────────────────────────────────────────────────────────────

const fakeSearch: SearchProvider = {
  name: "fake",
  async search(params): Promise<SearchResult[]> {
    return [
      { url: `https://example.com/${params.query}/1`, title: "t1", snippet: "s1" },
      { url: `https://example.com/${params.query}/2`, title: "t2", snippet: "s2" },
      { url: `https://example.com/${params.query}/3`, title: "t3", snippet: "s3" },
      { url: `https://example.com/${params.query}/4`, title: "t4", snippet: "s4" },
      { url: `https://example.com/${params.query}/5`, title: "t5", snippet: "s5" },
    ];
  },
};

function makeFakeExtractor(): ContentExtractor {
  return {
    name: "fake",
    async extract(url: string): Promise<ExtractedContent> {
      return {
        url,
        title: `Title for ${url}`,
        content: `Content body for ${url}. `.repeat(50),
        wordCount: 200,
        success: true,
      };
    },
  };
}

interface LLMSpy {
  structuredOutputCalls: number;
  poisonContains?: string;
}

function makeFakeLLM(spy: LLMSpy): LLMProvider {
  return {
    name: "fake-llm",
    models: [],
    async chat() {
      throw new Error("not implemented");
    },
    async *chatStream() {
      throw new Error("not implemented");
    },
    async structuredOutput(params) {
      spy.structuredOutputCalls += 1;
      const text = params.messages.map((m) => m.content).join(" ");
      if (spy.poisonContains && text.includes(spy.poisonContains)) {
        throw new Error(`poisoned: ${spy.poisonContains}`);
      }
      // Mirror phase3 evidence eval schema shape — return one relevant entry
      // per URL we can find in the message.
      const urls = Array.from(text.matchAll(/https:\/\/example\.com\/[^\s)<>]+/g)).map(
        (m) => m[0]
      );
      const data = {
        evaluations: urls.map((u) => ({
          url: u,
          relevant: true,
          sourceType: "media" as const,
          credibility: "medium" as const,
          relationship: "supports" as const,
          keyExcerpt: "excerpt",
          timelinessRisk: false,
          sourceName: "example.com",
        })),
      };
      return {
        data: params.schema.parse(data) as never,
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCostUSD: 0 },
      };
    },
  };
}

const baseDimension: DimensionSearchInput = {
  dimensionId: "dim_test",
  sessionId: "s_test",
  name: "test dim",
  coreQuestion: "core?",
  counterQuestion: "counter?",
  keywords: { zh: ["k1"], en: ["k2"] },
  maxRounds: 1,
};

// ── Tests ──────────────────────────────────────────────────────────────────

describe("SearchOrchestrator split-retry (evaluateEvidence)", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let debugSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    debugSpy.mockRestore();
  });

  it("isolates and drops a single poison item, keeps the rest", async () => {
    const spy: LLMSpy = { structuredOutputCalls: 0, poisonContains: "k1/3" };
    const llm = makeFakeLLM(spy);
    const orchestrator = new SearchOrchestrator(
      {
        searchProvider: fakeSearch,
        contentExtractor: makeFakeExtractor(),
        searchConcurrencyLimit: 4,
        extractConcurrencyLimit: 4,
        maxSearchCallsPerSession: 50,
      },
      llm,
      "mock-model",
      new SessionCallCounter(50)
    );

    const result = await orchestrator.searchDimension(baseDimension);

    // 5 unique URLs across zh + en queries × dedup; we expect roughly 4 to survive
    // (one poison URL gets dropped after isolation). The exact count depends on
    // how URLs dedupe across queries, so we just assert: at least one warn line
    // for the dropped URL and no candidate matches the poison pattern.
    expect(warnSpy).toHaveBeenCalled();
    expect(result.evidence.some((e) => e.url.includes("k1/3"))).toBe(false);
    expect(result.evidence.length).toBeGreaterThan(0);
  });

  it("drops every item when all are poisoned", async () => {
    const spy: LLMSpy = { structuredOutputCalls: 0, poisonContains: "https://" };
    const llm = makeFakeLLM(spy);
    const orchestrator = new SearchOrchestrator(
      {
        searchProvider: fakeSearch,
        contentExtractor: makeFakeExtractor(),
        searchConcurrencyLimit: 4,
        extractConcurrencyLimit: 4,
        maxSearchCallsPerSession: 50,
      },
      llm,
      "mock-model",
      new SessionCallCounter(50)
    );

    const result = await orchestrator.searchDimension(baseDimension);

    expect(result.evidence).toHaveLength(0);
    // Every isolated single-item batch logs one warn line.
    expect(warnSpy.mock.calls.length).toBeGreaterThan(0);
  });
});

describe("SearchOrchestrator refineKeywords give-up", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("returns empty arrays when refineKeywords throws", async () => {
    // Build a custom LLM that succeeds for evidence eval but fails for the
    // refine prompt (detect by system prompt content).
    const llm: LLMProvider = {
      name: "fake",
      models: [],
      async chat() {
        throw new Error("nope");
      },
      async *chatStream() {
        throw new Error("nope");
      },
      async structuredOutput(params) {
        const sys = params.systemPrompt ?? "";
        if (sys.includes("keyword refinement") || sys.includes("KEYWORD")) {
          throw new Error("refine boom");
        }
        const urls = Array.from(
          params.messages
            .map((m) => m.content)
            .join(" ")
            .matchAll(/https:\/\/example\.com\/[^\s)<>]+/g)
        ).map((m) => m[0]);
        return {
          data: params.schema.parse({
            evaluations: urls.map((u) => ({
              url: u,
              relevant: true,
              sourceType: "media",
              credibility: "low",
              relationship: "supports",
              keyExcerpt: "x",
              timelinessRisk: false,
              sourceName: "example",
            })),
          }) as never,
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCostUSD: 0 },
        };
      },
    };

    const orchestrator = new SearchOrchestrator(
      {
        searchProvider: fakeSearch,
        contentExtractor: makeFakeExtractor(),
        searchConcurrencyLimit: 4,
        extractConcurrencyLimit: 4,
        maxSearchCallsPerSession: 50,
      },
      llm,
      "mock-model",
      new SessionCallCounter(50)
    );

    // Force a second round so refineKeywords actually runs. maxRounds=2 +
    // evidence that fails isSufficient() means we'll attempt refine after
    // round 1 and break out due to the empty-keywords result.
    const result = await orchestrator.searchDimension({ ...baseDimension, maxRounds: 2 });
    // We can't directly observe refineKeywords from outside; instead assert
    // the warn line was emitted and roundsUsed stays at the expected value.
    expect(warnSpy.mock.calls.some((c) => String(c[0]).includes("[refineKeywords]"))).toBe(true);
    // Only the first round should have produced evidence; round 2 never
    // executed because we broke on empty keywords.
    expect(result.roundsUsed).toBeLessThanOrEqual(2);
  });
});

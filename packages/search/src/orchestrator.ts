import type { LLMProvider } from "@contritas/llm";
import {
  PHASE3_EVIDENCE_EVAL_SYSTEM_PROMPT,
  phase3EvidenceEvalSchema,
  PHASE3_KEYWORD_REFINE_SYSTEM_PROMPT,
  phase3KeywordRefineSchema,
} from "@contritas/llm";
import {
  MIN_SOURCES_PER_DIMENSION,
  MIN_HIGH_CREDIBILITY_SOURCES,
  SEARCH_CACHE_TTL_SECONDS,
} from "@contritas/shared";
import type {
  SearchOrchestratorConfig,
  DimensionSearchInput,
  DimensionSearchResult,
  EvidenceCandidate,
  SearchResult,
  ExtractedContent,
  SearchEventCallback,
} from "./types.js";
import { SessionCallCounter } from "./rate-limiter.js";
import { URLDeduplicator } from "./deduplicator.js";
import { buildCacheKey } from "./cache.js";
import pLimit from "p-limit";

export class SearchOrchestrator {
  private readonly config: SearchOrchestratorConfig;
  private readonly llmProvider: LLMProvider;
  private readonly llmModel: string;
  private readonly callCounter: SessionCallCounter;
  private readonly onEvent?: SearchEventCallback;
  private readonly searchLimiter: ReturnType<typeof pLimit>;
  private readonly extractLimiter: ReturnType<typeof pLimit>;

  constructor(
    config: SearchOrchestratorConfig,
    llmProvider: LLMProvider,
    llmModel: string,
    callCounter: SessionCallCounter,
    onEvent?: SearchEventCallback
  ) {
    this.config = config;
    this.llmProvider = llmProvider;
    this.llmModel = llmModel;
    this.callCounter = callCounter;
    this.onEvent = onEvent;
    this.searchLimiter = pLimit(config.searchConcurrencyLimit);
    this.extractLimiter = pLimit(config.extractConcurrencyLimit);
  }

  async searchDimension(input: DimensionSearchInput): Promise<DimensionSearchResult> {
    const evidence: EvidenceCandidate[] = [];
    const deduplicator = new URLDeduplicator();
    const usedQueries: string[] = [];
    let currentKeywords = { ...input.keywords };
    let roundsUsed = 0;
    const startingCalls = this.callCounter.used;

    for (let round = 1; round <= input.maxRounds; round++) {
      if (this.callCounter.exhausted) break;

      roundsUsed = round;

      // 1. Build search queries from keywords
      const queries = this.buildQueries(currentKeywords, round);

      // 2. Execute searches (with cache and fallback)
      const searchResults = await this.executeSearches(queries, usedQueries, deduplicator);

      // 3. Extract content from URLs
      const contents = await this.extractContents(
        searchResults.filter((r) => !deduplicator.isDuplicate(r.url))
      );

      // Mark URLs as seen
      for (const result of searchResults) {
        deduplicator.add(result.url);
      }

      // 4. Evaluate evidence via LLM (batch, max 5 per call)
      if (contents.length > 0) {
        const candidates = await this.evaluateEvidence(contents, input, round, usedQueries);
        for (const candidate of candidates) {
          evidence.push(candidate);
          this.onEvent?.({
            type: "evidence_added",
            dimensionId: input.dimensionId,
            source: candidate.url,
            credibility: candidate.credibility,
          });
        }
      }

      // Emit dimension update
      this.onEvent?.({
        type: "dimension_update",
        dimensionId: input.dimensionId,
        sourcesFound: evidence.length,
        round,
      });

      // 5. Check sufficiency
      if (this.isSufficient(evidence)) break;

      // 6. Refine keywords for next round (if not last round)
      if (round < input.maxRounds && !this.callCounter.exhausted) {
        currentKeywords = await this.refineKeywords(evidence, input, usedQueries);
      }
    }

    return {
      dimensionId: input.dimensionId,
      evidence,
      roundsUsed,
      searchCallsUsed: this.callCounter.used - startingCalls,
      sufficient: this.isSufficient(evidence),
    };
  }

  private buildQueries(
    keywords: { zh: string[]; en: string[] },
    round: number
  ): Array<{ query: string; language: "zh" | "en" }> {
    const queries: Array<{ query: string; language: "zh" | "en" }> = [];
    // For round 1, use all keywords; for subsequent rounds, keywords are already refined
    for (const kw of keywords.zh.slice(0, round === 1 ? 3 : 2)) {
      queries.push({ query: kw, language: "zh" });
    }
    for (const kw of keywords.en.slice(0, round === 1 ? 3 : 2)) {
      queries.push({ query: kw, language: "en" });
    }
    return queries;
  }

  private async executeSearches(
    queries: Array<{ query: string; language: "zh" | "en" }>,
    usedQueries: string[],
    deduplicator: URLDeduplicator
  ): Promise<SearchResult[]> {
    const allResults: SearchResult[] = [];

    const searchTasks = queries
      .filter((q) => !usedQueries.includes(q.query))
      .map((q) =>
        this.searchLimiter(async () => {
          if (this.callCounter.exhausted) return [];
          usedQueries.push(q.query);

          // Check cache
          const cacheKey = buildCacheKey(q.query, q.language);
          if (this.config.cache) {
            const cached = await this.config.cache.get(cacheKey);
            if (cached) {
              this.onEvent?.({
                type: "search_executed",
                query: q.query,
                language: q.language,
                resultsCount: cached.length,
              });
              return cached;
            }
          }

          // Execute search
          this.callCounter.increment();
          const results = await this.searchWithFallback({
            query: q.query,
            language: q.language,
            maxResults: 10,
            searchDepth: "advanced",
          });

          // Cache results
          if (this.config.cache && results.length > 0) {
            await this.config.cache.set(cacheKey, results, SEARCH_CACHE_TTL_SECONDS);
          }

          this.onEvent?.({
            type: "search_executed",
            query: q.query,
            language: q.language,
            resultsCount: results.length,
          });

          return results;
        })
      );

    const resultSets = await Promise.all(searchTasks);
    for (const results of resultSets) {
      for (const r of results) {
        if (!deduplicator.isDuplicate(r.url)) {
          allResults.push(r);
        }
      }
    }

    return allResults;
  }

  private async searchWithFallback(
    params: { query: string; language: "zh" | "en"; maxResults: number; searchDepth: "basic" | "advanced" }
  ): Promise<SearchResult[]> {
    try {
      return await this.config.searchProvider.search(params);
    } catch (err) {
      if (this.config.fallbackSearchProvider) {
        return await this.config.fallbackSearchProvider.search(params);
      }
      throw err;
    }
  }

  private async extractContents(results: SearchResult[]): Promise<ExtractedContent[]> {
    const extractTasks = results.map((r) =>
      this.extractLimiter(async () => {
        return await this.config.contentExtractor.extract(r.url);
      })
    );

    const extracted = await Promise.all(extractTasks);
    return extracted.filter((e) => e.success && e.content.length > 100);
  }

  private async evaluateEvidence(
    contents: ExtractedContent[],
    dimension: DimensionSearchInput,
    round: number,
    usedQueries: string[]
  ): Promise<EvidenceCandidate[]> {
    const candidates: EvidenceCandidate[] = [];
    const batchSize = 5;

    for (let i = 0; i < contents.length; i += batchSize) {
      const batch = contents.slice(i, i + batchSize);
      const contentSummaries = batch.map((c, idx) => {
        // Truncate content to ~2000 chars to fit in LLM context
        const truncated = c.content.length > 2000 ? c.content.slice(0, 2000) + "..." : c.content;
        return `--- Content ${idx + 1} (URL: ${c.url}) ---\nTitle: ${c.title}\n${truncated}\n`;
      }).join("\n");

      const userMessage = `## Research Dimension
Name: ${dimension.name}
Core Question: ${dimension.coreQuestion}
Counter-Question: ${dimension.counterQuestion}

## Extracted Contents (${batch.length} pieces)

${contentSummaries}

Evaluate each content piece. Respond with JSON.`;

      try {
        const { data } = await this.llmProvider.structuredOutput({
          model: this.llmModel,
          messages: [{ role: "user", content: userMessage }],
          schema: phase3EvidenceEvalSchema,
          systemPrompt: PHASE3_EVIDENCE_EVAL_SYSTEM_PROMPT,
          temperature: 0.1,
        });

        for (const evaluation of data.evaluations) {
          if (!evaluation.relevant) continue;

          const matchingContent = batch.find((c) => c.url === evaluation.url);
          candidates.push({
            url: evaluation.url,
            title: matchingContent?.title ?? "",
            sourceName: evaluation.sourceName,
            sourceType: evaluation.sourceType,
            credibility: evaluation.credibility,
            publishedDate: evaluation.publishedDate,
            language: this.detectLanguage(matchingContent?.content ?? ""),
            keyExcerpt: evaluation.keyExcerpt,
            relationship: evaluation.relationship,
            timelinessRisk: evaluation.timelinessRisk,
            searchQuery: usedQueries[usedQueries.length - 1] ?? "",
            searchRound: round,
          });
        }
      } catch {
        // LLM evaluation failure for a batch is non-fatal — skip batch
      }
    }

    return candidates;
  }

  private isSufficient(evidence: EvidenceCandidate[]): boolean {
    const uniqueUrls = new Set(evidence.map((e) => e.url)).size;
    const highCredibility = evidence.filter((e) => e.credibility === "high").length;
    return uniqueUrls >= MIN_SOURCES_PER_DIMENSION && highCredibility >= MIN_HIGH_CREDIBILITY_SOURCES;
  }

  private async refineKeywords(
    evidence: EvidenceCandidate[],
    dimension: DimensionSearchInput,
    usedQueries: string[]
  ): Promise<{ zh: string[]; en: string[] }> {
    const evidenceSummary = evidence.map((e) =>
      `- [${e.credibility}] ${e.sourceName}: ${e.relationship} (${e.keyExcerpt.slice(0, 100)})`
    ).join("\n");

    const userMessage = `## Research Dimension
Name: ${dimension.name}
Core Question: ${dimension.coreQuestion}
Counter-Question: ${dimension.counterQuestion}

## Evidence Collected So Far (${evidence.length} pieces)
${evidenceSummary}

## Previously Used Queries
${usedQueries.map((q) => `- "${q}"`).join("\n")}

Analyze gaps and suggest new keywords. Respond with JSON.`;

    try {
      const { data } = await this.llmProvider.structuredOutput({
        model: this.llmModel,
        messages: [{ role: "user", content: userMessage }],
        schema: phase3KeywordRefineSchema,
        systemPrompt: PHASE3_KEYWORD_REFINE_SYSTEM_PROMPT,
        temperature: 0.3,
      });

      return data.newKeywords;
    } catch {
      // If keyword refinement fails, return original keywords shuffled
      return dimension.keywords;
    }
  }

  private detectLanguage(text: string): "zh" | "en" {
    const chineseChars = text.match(/[\u4e00-\u9fff]/g)?.length ?? 0;
    return chineseChars > text.length * 0.1 ? "zh" : "en";
  }
}

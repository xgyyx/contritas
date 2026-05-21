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
  wrapExternalContent,
  EXTERNAL_CONTENT_SAFETY_CLAUSE,
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

      // 6. Refine keywords for next round (if not last round). If refine
      //    gives up (returns empty arrays), break: another round with no
      //    new queries would be pure waste.
      if (round < input.maxRounds && !this.callCounter.exhausted) {
        const refined = await this.refineKeywords(evidence, input, usedQueries);
        if (refined.zh.length === 0 && refined.en.length === 0) {
          break;
        }
        currentKeywords = refined;
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
          const cacheKey = buildCacheKey(q.query, q.language, this.config.searchProvider.name);
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
        // Check content cache first
        if (this.config.contentCache) {
          const cached = await this.config.contentCache.get(r.url);
          if (cached) return cached;
        }

        const extracted = await this.config.contentExtractor.extract(r.url);

        // Cache successful extraction
        if (extracted.success && this.config.contentCache) {
          await this.config.contentCache.set(r.url, extracted, SEARCH_CACHE_TTL_SECONDS);
        }

        return extracted;
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
    const batchSize = 5;
    const batches: ExtractedContent[][] = [];
    for (let i = 0; i < contents.length; i += batchSize) {
      batches.push(contents.slice(i, i + batchSize));
    }

    const results = await Promise.all(
      batches.map((b) => this.processBatch(b, dimension, round, usedQueries))
    );
    return results.flat();
  }

  /**
   * Evaluate a batch with split-retry: if the LLM rejects the whole batch
   * (oversize / unparseable / one toxic payload), recurse on halves so good
   * items still make it through. Only fully drop a single item after it has
   * been isolated, and log the drop.
   */
  private async processBatch(
    batch: ExtractedContent[],
    dimension: DimensionSearchInput,
    round: number,
    usedQueries: string[],
    depth = 0
  ): Promise<EvidenceCandidate[]> {
    try {
      return await this.evaluateBatchOnce(batch, dimension, round, usedQueries);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (batch.length === 1) {
        const url = batch[0]?.url ?? "unknown";
        console.warn(
          `[evaluateEvidence] dropping single content after retry: url=${url} depth=${depth} err=${message}`
        );
        return [];
      }
      const mid = Math.floor(batch.length / 2);
      console.debug(
        `[evaluateEvidence] split-retry size=${batch.length} depth=${depth} err=${message}`
      );
      const [left, right] = await Promise.all([
        this.processBatch(batch.slice(0, mid), dimension, round, usedQueries, depth + 1),
        this.processBatch(batch.slice(mid), dimension, round, usedQueries, depth + 1),
      ]);
      return [...left, ...right];
    }
  }

  private async evaluateBatchOnce(
    batch: ExtractedContent[],
    dimension: DimensionSearchInput,
    round: number,
    usedQueries: string[]
  ): Promise<EvidenceCandidate[]> {
    const contentSummaries = batch
      .map((c, idx) => {
        // Truncate content to ~2000 chars to fit in LLM context
        const truncated = c.content.length > 2000 ? c.content.slice(0, 2000) + "..." : c.content;
        const body = `Title: ${c.title}\n${truncated}`;
        return `--- Content ${idx + 1} ---\n${wrapExternalContent(body, { kind: "web-page", source: c.url })}\n`;
      })
      .join("\n");

    const userMessage = `## Research Dimension
Name: ${dimension.name}
Core Question: ${dimension.coreQuestion}
Counter-Question: ${dimension.counterQuestion}

## Extracted Contents (${batch.length} pieces)

${contentSummaries}

Evaluate each content piece. Respond with JSON.`;

    const { data } = await this.llmProvider.structuredOutput({
      model: this.llmModel,
      messages: [{ role: "user", content: userMessage }],
      schema: phase3EvidenceEvalSchema,
      systemPrompt: PHASE3_EVIDENCE_EVAL_SYSTEM_PROMPT + EXTERNAL_CONTENT_SAFETY_CLAUSE,
      temperature: 0.1,
    });

    const candidates: EvidenceCandidate[] = [];
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
    const evidenceSummary = evidence.map((e) => {
      const body = `[${e.credibility}] ${e.sourceName}: ${e.relationship}\nExcerpt: ${e.keyExcerpt.slice(0, 100)}`;
      return `- ${wrapExternalContent(body, { kind: "evidence-summary", source: e.url })}`;
    }).join("\n");

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
        systemPrompt: PHASE3_KEYWORD_REFINE_SYSTEM_PROMPT + EXTERNAL_CONTENT_SAFETY_CLAUSE,
        temperature: 0.3,
      });

      return data.newKeywords;
    } catch (err) {
      // 6.5.8: returning the old keywords meant the next round generated
      // zero new queries after dedup, looping uselessly. Returning empty
      // signals the caller to stop the dimension's search loop.
      const message = err instanceof Error ? err.message : String(err);
      console.warn(
        `[refineKeywords] giving up: dim=${dimension.dimensionId} round=${usedQueries.length} err=${message}`
      );
      return { zh: [], en: [] };
    }
  }

  private detectLanguage(text: string): "zh" | "en" {
    const chineseChars = text.match(/[\u4e00-\u9fff]/g)?.length ?? 0;
    return chineseChars > text.length * 0.1 ? "zh" : "en";
  }
}

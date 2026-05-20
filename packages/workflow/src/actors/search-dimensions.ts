import { fromPromise } from "xstate";
import { SearchOrchestrator, SessionCallCounter } from "@contritas/search";
import type { DimensionSearchInput } from "@contritas/search";
import { generateId } from "@contritas/shared";
import type { ResearchContext, WorkflowDeps, RetrievalResult, EvidenceData } from "../types.js";
import pLimit from "p-limit";

export interface SearchDimensionsInput {
  context: ResearchContext;
  deps: WorkflowDeps;
}

export const searchDimensions = fromPromise(
  async ({ input }: { input: SearchDimensionsInput }): Promise<RetrievalResult> => {
    const { context, deps } = input;

    if (!deps.searchDeps) {
      throw new Error("SearchDeps not configured — cannot execute retrieval phase");
    }

    const { searchDeps } = deps;
    const callCounter = new SessionCallCounter(searchDeps.maxSearchCallsPerSession);

    const orchestrator = new SearchOrchestrator(
      {
        searchProvider: searchDeps.searchProvider,
        fallbackSearchProvider: searchDeps.fallbackSearchProvider,
        contentExtractor: searchDeps.contentExtractor,
        cache: searchDeps.cache,
        contentCache: searchDeps.contentCache,
        searchConcurrencyLimit: searchDeps.searchConcurrencyLimit,
        extractConcurrencyLimit: searchDeps.extractConcurrencyLimit,
        maxSearchCallsPerSession: searchDeps.maxSearchCallsPerSession,
      },
      deps.llmProvider,
      searchDeps.evidenceEvalModel ?? deps.getModelForPhase("retrieval"),
      callCounter,
      (event) => {
        // Forward search events through workflow event system
        deps.emitEvent(event);
      }
    );

    // Process dimensions with controlled concurrency
    const dimensionLimiter = pLimit(searchDeps.searchConcurrencyLimit);
    const allEvidence: EvidenceData[] = [];
    const dimensionResults: RetrievalResult["dimensionResults"] = [];

    // If targetedDimensions is set (self-check retry), only re-search those dimensions.
    // Use dimensionIdMap (set after first retrieval) to match dimensionIds back to dimensions.
    const targetDimIds = context.targetedDimensions && context.targetedDimensions.length > 0
      ? new Set(context.targetedDimensions)
      : null;

    let dimensionsToSearch: { dim: typeof context.dimensions[number]; existingId?: string }[];
    if (targetDimIds && context.dimensionIdMap) {
      dimensionsToSearch = context.dimensions
        .map((dim, idx) => ({ dim, existingId: context.dimensionIdMap![idx] }))
        .filter(({ existingId }) => existingId != null && targetDimIds.has(existingId));
    } else {
      dimensionsToSearch = context.dimensions.map((dim) => ({ dim }));
    }

    const dimensionInputs: DimensionSearchInput[] = dimensionsToSearch.map(({ dim, existingId }) => ({
      dimensionId: existingId ?? generateId(),
      sessionId: context.sessionId,
      name: dim.name,
      coreQuestion: dim.coreQuestion,
      counterQuestion: dim.counterQuestion,
      keywords: dim.keywords,
      maxRounds: 5,
    }));

    const tasks = dimensionInputs.map((dimInput) =>
      dimensionLimiter(async () => {
        const result = await orchestrator.searchDimension(dimInput);

        dimensionResults.push({
          dimensionId: result.dimensionId,
          sufficient: result.sufficient,
          roundsUsed: result.roundsUsed,
        });

        for (const candidate of result.evidence) {
          allEvidence.push({
            dimensionId: result.dimensionId,
            url: candidate.url,
            title: candidate.title,
            sourceName: candidate.sourceName,
            sourceType: candidate.sourceType,
            credibility: candidate.credibility,
            publishedDate: candidate.publishedDate,
            language: candidate.language,
            keyExcerpt: candidate.keyExcerpt,
            relationship: candidate.relationship,
            timelinessRisk: candidate.timelinessRisk,
            searchQuery: candidate.searchQuery,
            searchRound: candidate.searchRound,
          });
        }
      })
    );

    await Promise.all(tasks);

    return {
      evidence: allEvidence,
      searchCallsUsed: callCounter.used,
      dimensionResults,
    };
  }
);

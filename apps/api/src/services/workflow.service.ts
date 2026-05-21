import { createActor } from "xstate";
import { eq } from "drizzle-orm";
import { createResearchMachine, type ResearchContext, type WorkflowDeps, type WorkflowEmittedEvent, type SearchDeps, type AssumptionData, type DimensionData, type EvidenceData } from "@contritas/workflow";
import { generateId, type ProgressEvent } from "@contritas/shared";
import {
  SEARCH_CONCURRENT_LIMIT,
  EXTRACT_CONCURRENT_LIMIT,
  MAX_SEARCH_CALLS_PER_SESSION,
  DEFAULT_TOKEN_BUDGET_USD,
  wrapExternalContent,
} from "@contritas/shared";
import { createProvider, type LLMProvider, ModelRouter, createTieredRoutingConfig } from "@contritas/llm";
import {
  TavilySearchProvider,
  SerperSearchProvider,
  JinaExtractor,
  FirecrawlExtractor,
  WebArchiveExtractor,
  FallbackExtractorChain,
  RedisSearchCache,
  RedisContentCache,
} from "@contritas/search";
import { db, schema } from "../drizzle/index.js";
import { publishEvent } from "./stream.service.js";
import * as sessionService from "./session.service.js";
import type { SearchConfig } from "../config.js";
import { getRedis } from "../lib/redis.js";
import { createLogger } from "../lib/logger.js";

const log = createLogger("workflow");

export interface WorkflowRunResult {
  finalState: string;
  context: ResearchContext;
}

export function createInitialContext(
  sessionId: string,
  originalText: string,
  language: "zh" | "en"
): ResearchContext {
  return {
    sessionId,
    input: {
      originalText,
      language,
    },
    assumptions: [],
    dimensions: [],
    evidence: [],
    crossValidations: [],
    phases: [],
    currentPhase: "inputValidation",
    clarificationHistory: [],
    tokenUsage: {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      estimatedCostUSD: 0,
    },
    searchCallsUsed: 0,
    selfCheckRetries: 0,
  };
}

export function buildSearchDeps(
  searchConfig: SearchConfig,
  evidenceEvalModel?: string,
): SearchDeps | undefined {
  // Build search provider (require at least one)
  let searchProvider;
  let fallbackSearchProvider;

  if (searchConfig.tavilyApiKey) {
    searchProvider = new TavilySearchProvider(searchConfig.tavilyApiKey);
    if (searchConfig.serperApiKey) {
      fallbackSearchProvider = new SerperSearchProvider(searchConfig.serperApiKey);
    }
  } else if (searchConfig.serperApiKey) {
    searchProvider = new SerperSearchProvider(searchConfig.serperApiKey);
  } else {
    return undefined;
  }

  // Build content extractor (fallback chain)
  const extractors = [];
  extractors.push(new JinaExtractor(searchConfig.jinaApiKey));
  if (searchConfig.firecrawlApiKey) {
    extractors.push(new FirecrawlExtractor(searchConfig.firecrawlApiKey));
  }
  extractors.push(new WebArchiveExtractor(searchConfig.jinaApiKey));
  const contentExtractor = new FallbackExtractorChain(extractors);

  // Build cache
  let cache;
  let contentCache;
  try {
    const redis = getRedis();
    cache = new RedisSearchCache(redis);
    contentCache = new RedisContentCache(redis);
  } catch {
    // Redis not available — proceed without cache
  }

  return {
    searchProvider,
    fallbackSearchProvider,
    contentExtractor,
    cache,
    contentCache,
    searchConcurrencyLimit: SEARCH_CONCURRENT_LIMIT,
    extractConcurrencyLimit: EXTRACT_CONCURRENT_LIMIT,
    maxSearchCallsPerSession: MAX_SEARCH_CALLS_PER_SESSION,
    evidenceEvalModel,
  };
}

export function createWorkflowDeps(
  sessionId: string,
  llmProvider: LLMProvider,
  llmModel: string,
  cheapModel: string,
  searchDeps?: SearchDeps
): WorkflowDeps {
  const router = new ModelRouter(
    createTieredRoutingConfig(llmProvider.name, llmModel, cheapModel)
  );

  return {
    llmProvider,
    getModelForPhase: (phase) => router.getModelForPhase(phase).model,
    searchDeps,
    tokenBudgetUSD: DEFAULT_TOKEN_BUDGET_USD,
    emitEvent: (event: WorkflowEmittedEvent) => {
      const progressEvent: ProgressEvent = (() => {
        switch (event.type) {
          case "phase_change":
            return {
              type: "phase_change" as const,
              phase: event.phase,
              status: event.status,
              timestamp: new Date().toISOString(),
            };
          case "clarification":
            return {
              type: "clarification" as const,
              questions: event.questions,
              suggestedDirections: event.suggestedDirections,
              timestamp: new Date().toISOString(),
            };
          case "error":
            return {
              type: "error" as const,
              message: event.message,
              recoverable: event.recoverable,
              timestamp: new Date().toISOString(),
            };
          case "dimension_update":
            return {
              type: "dimension_update" as const,
              dimensionId: event.dimensionId,
              sourcesFound: event.sourcesFound,
              round: event.round,
              timestamp: new Date().toISOString(),
            };
          case "search_executed":
            return {
              type: "search_executed" as const,
              query: event.query,
              language: event.language,
              resultsCount: event.resultsCount,
              timestamp: new Date().toISOString(),
            };
          case "evidence_added":
            return {
              type: "evidence_added" as const,
              dimensionId: event.dimensionId,
              source: event.source,
              credibility: event.credibility,
              timestamp: new Date().toISOString(),
            };
          case "validation_complete":
            return {
              type: "validation_complete" as const,
              contradictionsFound: event.contradictionsFound,
              timestamp: new Date().toISOString(),
            };
          case "report_ready":
            return {
              type: "report_ready" as const,
              reportId: event.reportId,
              timestamp: new Date().toISOString(),
            };
          case "eta_update":
            return {
              type: "eta_update" as const,
              estimatedSecondsRemaining: event.estimatedSecondsRemaining,
              timestamp: new Date().toISOString(),
            };
        }
      })();

      // Fire and forget — errors logged but don't block workflow
      publishEvent(sessionId, progressEvent).catch((err) => {
        log.error({ sessionId, err }, "failed to publish event");
      });
    },
    persistState: async (context: ResearchContext) => {
      try {
        // Record phases / search calls / token usage early so cost is captured even if
        // entity persistence fails partway through (6.2.8).
        await sessionService.updateSessionPhases(sessionId, context.phases);
        if (context.searchCallsUsed > 0) {
          await sessionService.updateSearchCallsUsed(sessionId, context.searchCallsUsed);
        }
        if (context.tokenUsage.totalTokens > 0) {
          await sessionService.updateTokenUsage(sessionId, context.tokenUsage);
        }

        // Persist assumptions (upsert by stable id — no more delete-then-insert)
        for (const assumption of context.assumptions) {
          await db
            .insert(schema.assumptions)
            .values({
              id: assumption.id,
              sessionId,
              content: assumption.content,
              type: assumption.type,
              importance: assumption.importance,
              order: assumption.order,
            })
            .onConflictDoUpdate({
              target: schema.assumptions.id,
              set: {
                content: assumption.content,
                type: assumption.type,
                importance: assumption.importance,
                order: assumption.order,
              },
            });
        }

        // Persist dimensions (upsert by stable id)
        for (const dimension of context.dimensions) {
          await db
            .insert(schema.dimensions)
            .values({
              id: dimension.id,
              sessionId,
              name: dimension.name,
              coreQuestion: dimension.coreQuestion,
              counterQuestion: dimension.counterQuestion,
              assumptionIds: dimension.relatedAssumptionIndices.map(String),
              keywords: dimension.keywords,
              status: "pending",
            })
            .onConflictDoUpdate({
              target: schema.dimensions.id,
              set: {
                name: dimension.name,
                coreQuestion: dimension.coreQuestion,
                counterQuestion: dimension.counterQuestion,
                assumptionIds: dimension.relatedAssumptionIndices.map(String),
                keywords: dimension.keywords,
              },
            });
        }

        // Persist evidence (upsert by stable id; FK to dimensions.id now aligns)
        for (const ev of context.evidence) {
          await db
            .insert(schema.evidence)
            .values({
              id: ev.id,
              sessionId,
              dimensionId: ev.dimensionId,
              searchQuery: ev.searchQuery,
              searchRound: ev.searchRound,
              url: ev.url,
              title: ev.title,
              sourceName: ev.sourceName,
              sourceType: ev.sourceType,
              credibility: ev.credibility,
              publishedDate: ev.publishedDate,
              language: ev.language,
              keyExcerpt: ev.keyExcerpt,
              relationship: ev.relationship,
              timelinessRisk: ev.timelinessRisk,
            })
            .onConflictDoUpdate({
              target: schema.evidence.id,
              set: {
                dimensionId: ev.dimensionId,
                searchQuery: ev.searchQuery,
                searchRound: ev.searchRound,
                url: ev.url,
                title: ev.title,
                sourceName: ev.sourceName,
                sourceType: ev.sourceType,
                credibility: ev.credibility,
                publishedDate: ev.publishedDate,
                language: ev.language,
                keyExcerpt: ev.keyExcerpt,
                relationship: ev.relationship,
                timelinessRisk: ev.timelinessRisk,
              },
            });
        }

        // Persist cross-validations (upsert by stable id)
        for (const cv of context.crossValidations) {
          await db
            .insert(schema.crossValidations)
            .values({
              id: cv.id,
              sessionId,
              dimensionId: cv.dimensionId,
              evidenceIds: cv.evidenceIds,
              consistent: cv.consistent,
              contradictionDescription: cv.contradictionDescription,
              contradictionReason: cv.contradictionReason,
            })
            .onConflictDoUpdate({
              target: schema.crossValidations.id,
              set: {
                dimensionId: cv.dimensionId,
                evidenceIds: cv.evidenceIds,
                consistent: cv.consistent,
                contradictionDescription: cv.contradictionDescription,
                contradictionReason: cv.contradictionReason,
              },
            });
        }

        // Update dimension verdict/confidence from cross-validation results.
        // Now that dimension ids are stable, this reliably hits the right rows.
        for (const cv of context.crossValidations) {
          await db
            .update(schema.dimensions)
            .set({
              verdict: cv.verdict,
              confidence: cv.confidence,
            })
            .where(eq(schema.dimensions.id, cv.dimensionId));
        }

        // Persist report (upsert by (sessionId, version) so self-check retries can refresh it)
        if (context.report) {
          await db
            .insert(schema.reports)
            .values({
              id: generateId(),
              sessionId,
              version: 1,
              markdownContent: context.report.markdownContent,
              overallScore: context.report.overallScore,
              overallVerdict: context.report.overallVerdict,
              charCount: context.report.charCount,
              sourceCount: context.report.sourceCount,
            })
            .onConflictDoUpdate({
              target: [schema.reports.sessionId, schema.reports.version],
              set: {
                markdownContent: context.report.markdownContent,
                overallScore: context.report.overallScore,
                overallVerdict: context.report.overallVerdict,
                charCount: context.report.charCount,
                sourceCount: context.report.sourceCount,
                generatedAt: new Date(),
              },
            });
        }
      } catch (err) {
        // 6.2.7: persistState failures are no longer silently swallowed. We surface them via
        // SSE and mark the session failed so the UI can react. We still don't rethrow because
        // persistState is invoked fire-and-forget from the state machine; full BullMQ
        // failure semantics are 6.3's responsibility.
        const message = err instanceof Error ? err.message : String(err);
        log.error({ sessionId, err }, "failed to persist state");
        await publishEvent(sessionId, {
          type: "error",
          message: `Persistence failed: ${message}`,
          recoverable: false,
          timestamp: new Date().toISOString(),
        }).catch(() => {});
        await sessionService.updateSessionStatus(sessionId, "failed").catch(() => {});
      }
    },
  };
}

export async function runWorkflow(
  sessionId: string,
  originalText: string,
  language: "zh" | "en",
  llmProvider: LLMProvider,
  llmModel: string,
  cheapModel: string,
  searchDeps?: SearchDeps
): Promise<WorkflowRunResult> {
  const context = createInitialContext(sessionId, originalText, language);
  const workflowDeps = createWorkflowDeps(sessionId, llmProvider, llmModel, cheapModel, searchDeps);
  const machine = createResearchMachine(workflowDeps);

  return new Promise((resolve, reject) => {
    const actor = createActor(machine, { input: context });

    actor.subscribe({
      complete: () => {
        const snapshot = actor.getSnapshot();
        resolve({
          finalState: snapshot.value as string,
          context: snapshot.context,
        });
      },
      error: (err) => {
        reject(err);
      },
    });

    actor.start();
  });
}

/**
 * Run workflow with support for pausing at awaitingClarification state.
 * Returns a controller that allows sending user responses.
 */
export function createWorkflowController(
  sessionId: string,
  originalText: string,
  language: "zh" | "en",
  llmProvider: LLMProvider,
  llmModel: string,
  cheapModel: string,
  searchDeps?: SearchDeps
) {
  const context = createInitialContext(sessionId, originalText, language);
  const workflowDeps = createWorkflowDeps(sessionId, llmProvider, llmModel, cheapModel, searchDeps);
  const machine = createResearchMachine(workflowDeps);
  const actor = createActor(machine, { input: context });

  return {
    actor,
    start() {
      actor.start();
    },
    sendUserResponse(response: string) {
      actor.send({ type: "USER_RESPONSE", response });
    },
    cancel() {
      actor.send({ type: "CANCEL" });
    },
    getState() {
      return actor.getSnapshot().value;
    },
    getContext() {
      return actor.getSnapshot().context;
    },
    onComplete(callback: (result: WorkflowRunResult) => void) {
      actor.subscribe({
        complete: () => {
          const snapshot = actor.getSnapshot();
          callback({
            finalState: snapshot.value as string,
            context: snapshot.context,
          });
        },
      });
    },
    onError(callback: (err: unknown) => void) {
      actor.subscribe({
        error: (err: unknown) => callback(err),
      });
    },
  };
}

/**
 * Build a ResearchContext from a parent session's data for iterate workflows.
 */
export async function createIterateContext(
  childSessionId: string,
  parentSessionId: string,
  iterationType: "deep_dive" | "add_dimension",
  target?: string,
  details?: string,
): Promise<{ context: ResearchContext; initialState: string }> {
  const parentSession = await sessionService.getSession(parentSessionId);
  if (!parentSession) {
    throw new Error(`Parent session ${parentSessionId} not found`);
  }

  const parentInput = parentSession.input as { originalText: string; language: "zh" | "en" };
  const parentAssumptions = await sessionService.getAssumptions(parentSessionId);
  const parentDimensions = await sessionService.getDimensions(parentSessionId);
  const parentEvidence = await sessionService.getEvidence(parentSessionId);

  // Map DB rows to workflow types — preserve stable ids so iterate sessions write back to
  // the same rows (FK from evidence → dimensions stays valid).
  const assumptions: AssumptionData[] = parentAssumptions.map((a) => ({
    id: a.id,
    content: a.content,
    type: a.type as "factual" | "judgmental",
    importance: a.importance as "high" | "medium" | "low",
    order: a.order,
  }));

  const dimensions: DimensionData[] = parentDimensions.map((d) => ({
    id: d.id,
    name: d.name,
    coreQuestion: d.coreQuestion,
    counterQuestion: d.counterQuestion,
    keywords: d.keywords as { zh: string[]; en: string[] },
    relatedAssumptionIndices: (d.assumptionIds ?? []).map(Number),
  }));

  const evidence: EvidenceData[] = parentEvidence.map((e) => ({
    id: e.id,
    dimensionId: e.dimensionId,
    url: e.url,
    title: e.title ?? "",
    sourceName: e.sourceName ?? "",
    sourceType: e.sourceType,
    credibility: e.credibility,
    publishedDate: e.publishedDate ?? undefined,
    language: e.language as "zh" | "en",
    keyExcerpt: e.keyExcerpt,
    relationship: e.relationship,
    timelinessRisk: e.timelinessRisk ?? false,
    searchQuery: e.searchQuery,
    searchRound: e.searchRound,
  }));

  let initialState: string;
  let contextEvidence: EvidenceData[];
  let contextDimensions: DimensionData[];
  let targetedDimensions: string[] | undefined;

  if (iterationType === "deep_dive") {
    // Reuse all parent data, start from retrieval with targeted dimension
    initialState = "retrieval";
    contextDimensions = dimensions;
    contextEvidence = evidence;
    targetedDimensions = target ? [target] : undefined;
  } else {
    // add_dimension: reuse assumptions, start from planning to let LLM add new dimensions
    initialState = "planning";
    contextDimensions = [];
    contextEvidence = [];
  }

  // Append user-provided details to the proposition for additional context.
  // `details` is user input — wrap in sentinel so downstream prompts cannot mistake it for instructions.
  const originalText = details
    ? `${parentInput.originalText}\n\n[迭代补充说明]\n${wrapExternalContent(details, { kind: "iterate-details" })}`
    : parentInput.originalText;

  const context: ResearchContext = {
    sessionId: childSessionId,
    input: {
      originalText,
      language: parentInput.language,
    },
    assumptions,
    dimensions: contextDimensions,
    evidence: contextEvidence,
    crossValidations: [],
    phases: [],
    currentPhase: initialState as any,
    clarificationHistory: [],
    tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCostUSD: 0 },
    searchCallsUsed: 0,
    selfCheckRetries: 0,
    targetedDimensions,
  };

  return { context, initialState };
}

/**
 * Create a workflow controller from a pre-built context and initial state.
 * Used for iterate workflows that start from a mid-pipeline state.
 */
export function createWorkflowControllerFromContext(
  sessionId: string,
  context: ResearchContext,
  initialState: string,
  llmProvider: LLMProvider,
  llmModel: string,
  cheapModel: string,
  searchDeps?: SearchDeps,
) {
  const workflowDeps = createWorkflowDeps(sessionId, llmProvider, llmModel, cheapModel, searchDeps);
  const machine = createResearchMachine(workflowDeps, initialState);
  const actor = createActor(machine, { input: context });

  return {
    actor,
    start() {
      actor.start();
    },
    sendUserResponse(response: string) {
      actor.send({ type: "USER_RESPONSE", response });
    },
    cancel() {
      actor.send({ type: "CANCEL" });
    },
    getState() {
      return actor.getSnapshot().value;
    },
    getContext() {
      return actor.getSnapshot().context;
    },
    onComplete(callback: (result: WorkflowRunResult) => void) {
      actor.subscribe({
        complete: () => {
          const snapshot = actor.getSnapshot();
          callback({
            finalState: snapshot.value as string,
            context: snapshot.context,
          });
        },
      });
    },
    onError(callback: (err: unknown) => void) {
      actor.subscribe({
        error: (err: unknown) => callback(err),
      });
    },
  };
}

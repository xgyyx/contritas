import { createActor } from "xstate";
import { eq } from "drizzle-orm";
import { createResearchMachine, type ResearchContext, type WorkflowDeps, type WorkflowEmittedEvent } from "@contritas/workflow";
import { generateId, type ProgressEvent } from "@contritas/shared";
import { createProvider, type LLMProvider } from "@contritas/llm";
import { db, schema } from "../drizzle/index.js";
import { publishEvent } from "./stream.service.js";
import * as sessionService from "./session.service.js";

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
    phases: [],
    currentPhase: "inputValidation",
    clarificationHistory: [],
    tokenUsage: {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      estimatedCostUSD: 0,
    },
  };
}

export function createWorkflowDeps(
  sessionId: string,
  llmProvider: LLMProvider,
  llmModel: string
): WorkflowDeps {
  return {
    llmProvider,
    llmModel,
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
        }
      })();

      // Fire and forget — errors logged but don't block workflow
      publishEvent(sessionId, progressEvent).catch((err) => {
        console.error(`Failed to publish event for session ${sessionId}:`, err);
      });
    },
    persistState: async (context: ResearchContext) => {
      try {
        await sessionService.updateSessionPhases(sessionId, context.phases);

        // Persist assumptions if they exist
        if (context.assumptions.length > 0) {
          // Upsert assumptions
          for (const assumption of context.assumptions) {
            const id = generateId();
            await db
              .insert(schema.assumptions)
              .values({
                id,
                sessionId,
                content: assumption.content,
                type: assumption.type,
                importance: assumption.importance,
                order: assumption.order,
              })
              .onConflictDoNothing();
          }
        }

        // Persist dimensions if they exist
        if (context.dimensions.length > 0) {
          for (const dimension of context.dimensions) {
            const id = generateId();
            await db
              .insert(schema.dimensions)
              .values({
                id,
                sessionId,
                name: dimension.name,
                coreQuestion: dimension.coreQuestion,
                counterQuestion: dimension.counterQuestion,
                assumptionIds: dimension.relatedAssumptionIndices.map(String),
                keywords: dimension.keywords,
                status: "pending",
              })
              .onConflictDoNothing();
          }
        }
      } catch (err) {
        console.error(`Failed to persist state for session ${sessionId}:`, err);
      }
    },
  };
}

export async function runWorkflow(
  sessionId: string,
  originalText: string,
  language: "zh" | "en",
  llmProvider: LLMProvider,
  llmModel: string
): Promise<WorkflowRunResult> {
  const context = createInitialContext(sessionId, originalText, language);
  const workflowDeps = createWorkflowDeps(sessionId, llmProvider, llmModel);
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
  llmModel: string
) {
  const context = createInitialContext(sessionId, originalText, language);
  const workflowDeps = createWorkflowDeps(sessionId, llmProvider, llmModel);
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

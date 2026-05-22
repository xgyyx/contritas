import type { Job } from "bullmq";
import { createProvider } from "@contritas/llm";
import type { ResearchJobData } from "../lib/queue.js";
import * as sessionService from "../services/session.service.js";
import { createWorkflowController, createWorkflowControllerFromContext, createIterateContext, buildSearchDeps } from "../services/workflow.service.js";
import { createRedisConnection } from "../lib/redis.js";
import { createLogger, type Logger } from "../lib/logger.js";
import { loadConfig } from "../config.js";

const CLARIFICATION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
const LOCK_EXTEND_INTERVAL_MS = 15_000;
const LOCK_EXTEND_DURATION_MS = 60_000;

export async function processResearchJob(job: Job<ResearchJobData>): Promise<void> {
  const { sessionId, parentSessionId, iterationType, target, details, requestId } = job.data;
  const log = createLogger("worker.job", {
    jobId: job.id,
    sessionId,
    parentSessionId,
    requestId,
  });

  log.info("processing research job");

  // Load session from DB
  const session = await sessionService.getSession(sessionId);
  if (!session) {
    throw new Error(`Session ${sessionId} not found`);
  }

  if (session.status === "cancelled") {
    log.info("session was cancelled, skipping");
    return;
  }

  // Defensive guard against stalled-job redelivery re-running a finished
  // session. Even with attempts:1, BullMQ may re-deliver a job whose lock
  // expired; we don't want to repeat a completed pipeline.
  if (session.status === "completed" || session.status === "failed") {
    log.info({ status: session.status }, "session already terminal, skipping");
    return;
  }

  // Create LLM provider
  const sessionConfig = session.config as { llmProvider: string; llmModel: string };
  const appConfig = loadConfig();

  const llmProvider = createProvider(appConfig.llmProvider);

  const input = session.input as { originalText: string; language: "zh" | "en" };

  // Resolve the premium ("default" tier) model and the optional cheap-tier
  // model. cheapModel falls back to the premium model when unset so the
  // two-tier router degrades gracefully into single-model behavior.
  const model = sessionConfig.llmModel || process.env.OPENAI_COMPATIBLE_MODEL || "claude-sonnet-4-20250514";
  const cheapModel = appConfig.cheapModel || model;

  // Build search dependencies — pass cheapModel as the evidence-eval model
  // so search-dimensions / orchestrator route to Haiku-class for extraction.
  const searchDeps = buildSearchDeps(appConfig.search, cheapModel);

  let controller;
  if (parentSessionId && iterationType) {
    const { context, initialState } = await createIterateContext(
      sessionId,
      parentSessionId,
      iterationType,
      target,
      details,
    );
    controller = createWorkflowControllerFromContext(
      sessionId,
      context,
      initialState,
      llmProvider,
      model,
      cheapModel,
      searchDeps,
    );
  } else {
    controller = createWorkflowController(
      sessionId,
      input.originalText,
      input.language,
      llmProvider,
      model,
      cheapModel,
      searchDeps,
    );
  }

  // Handle workflow completion
  const completionPromise = new Promise<void>((resolve, reject) => {
    controller.onComplete(async (result) => {
      const finalStatus = result.finalState === "failed" ? "failed"
        : result.finalState === "cancelled" ? "cancelled"
        : result.finalState === "budgetExceeded" ? "failed"
        : "completed";

      await sessionService.updateSessionStatus(sessionId, finalStatus as "completed" | "failed" | "cancelled");
      log.info({ finalState: result.finalState }, "session finished");
      resolve();
    });

    controller.onError((err) => {
      log.error({ err }, "session error");
      reject(err);
    });
  });

  // Track in-flight clarification waits and the previous state value so we
  // only react on the edge into awaitingClarification (re-entries during
  // iterate or LLM-driven loops would otherwise spawn duplicate subscribers).
  const actor = controller.actor;
  let prevState: unknown = undefined;
  let clarificationInFlight: Promise<void> | null = null;

  actor.subscribe((snapshot: { value: unknown }) => {
    const state = snapshot.value;
    if (state === "awaitingClarification" && prevState !== "awaitingClarification") {
      if (!clarificationInFlight) {
        clarificationInFlight = handleAwaitingClarification(sessionId, controller, job, log)
          .catch((err) => {
            log.error({ err }, "error handling clarification");
            throw err;
          })
          .finally(() => {
            clarificationInFlight = null;
          });
      }
    }
    prevState = state;
  });

  // Start the workflow
  controller.start();

  // Wait for completion
  await completionPromise;
}

// Exported for unit testing (6.7.6). Production code paths route through
// processResearchJob which is the only in-tree caller.
export async function handleAwaitingClarification(
  sessionId: string,
  controller: ReturnType<typeof createWorkflowController>,
  job: Job,
  log: Logger
): Promise<void> {
  // BullMQ uses the job token to authenticate lock extension. Without it the
  // lock will silently fail to extend and the job becomes eligible for stalled
  // recovery — which would re-deliver the job mid-clarification.
  const token = job.token;
  if (!token) {
    throw new Error(`[Worker] Missing job token for session ${sessionId}`);
  }

  log.debug("awaiting clarification");
  await sessionService.updateSessionStatus(sessionId, "awaiting_input");

  const subscriber = createRedisConnection();
  const channel = `research:${sessionId}:response`;

  let timeout: NodeJS.Timeout | undefined;
  let lockExtender: NodeJS.Timeout | undefined;
  let settled = false;

  type Outcome = { kind: "response"; message: string } | { kind: "timeout" };

  try {
    const outcome = await new Promise<Outcome>((resolve, reject) => {
      const settle = (cb: () => void) => {
        if (settled) return;
        settled = true;
        cb();
      };

      timeout = setTimeout(() => {
        settle(() => resolve({ kind: "timeout" }));
      }, CLARIFICATION_TIMEOUT_MS);

      // Single message handler — only the first reply wins; later messages
      // (e.g. duplicate publishes) are ignored because settled flips true.
      subscriber.on("message", (_ch: string, message: string) => {
        settle(() => resolve({ kind: "response", message }));
      });

      subscriber.subscribe(channel).catch((err) => {
        settle(() => reject(err));
      });

      // Keep the BullMQ lock alive while we wait. extendLock requires the
      // job's lock token; failures here are real (token mismatch / job moved)
      // and must surface so the job is treated as failed rather than silently
      // losing its lock.
      lockExtender = setInterval(() => {
        job.extendLock(token, LOCK_EXTEND_DURATION_MS).catch((err) => {
          settle(() => reject(err instanceof Error ? err : new Error(String(err))));
        });
      }, LOCK_EXTEND_INTERVAL_MS);
    });

    if (outcome.kind === "timeout") {
      controller.cancel();
      throw new Error(`Clarification timeout for session ${sessionId}`);
    }

    await sessionService.updateSessionStatus(sessionId, "in_progress");
    controller.sendUserResponse(outcome.message);
  } finally {
    if (timeout) clearTimeout(timeout);
    if (lockExtender) clearInterval(lockExtender);
    try {
      await subscriber.unsubscribe(channel);
    } catch {
      // ignore — connection may already be closing
    }
    try {
      await subscriber.quit();
    } catch {
      subscriber.disconnect();
    }
  }
}

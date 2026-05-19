import type { Job } from "bullmq";
import { createProvider } from "@contritas/llm";
import type { ResearchJobData } from "../lib/queue.js";
import * as sessionService from "../services/session.service.js";
import { createWorkflowController } from "../services/workflow.service.js";
import { createRedisConnection } from "../lib/redis.js";
import { publishEvent } from "../services/stream.service.js";

const CLARIFICATION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

export async function processResearchJob(job: Job<ResearchJobData>): Promise<void> {
  const { sessionId } = job.data;

  console.log(`[Worker] Processing research job: ${sessionId}`);

  // Load session from DB
  const session = await sessionService.getSession(sessionId);
  if (!session) {
    throw new Error(`Session ${sessionId} not found`);
  }

  if (session.status === "cancelled") {
    console.log(`[Worker] Session ${sessionId} was cancelled, skipping`);
    return;
  }

  // Create LLM provider
  const sessionConfig = session.config as { llmProvider: string; llmModel: string };
  const { loadConfig } = await import("../config.js");
  const appConfig = loadConfig();

  const llmProvider = createProvider(appConfig.llmProvider);

  const input = session.input as { originalText: string; language: "zh" | "en" };

  // Create workflow controller
  const model = sessionConfig.llmModel || process.env.OPENAI_COMPATIBLE_MODEL || "claude-sonnet-4-20250514";
  const controller = createWorkflowController(
    sessionId,
    input.originalText,
    input.language,
    llmProvider,
    model
  );

  // Handle workflow completion
  const completionPromise = new Promise<void>((resolve, reject) => {
    controller.onComplete(async (result) => {
      const finalStatus = result.finalState === "failed" ? "failed"
        : result.finalState === "cancelled" ? "cancelled"
        : "completed";

      // For Phase 1, retrievalPending is the end of the line
      const status = result.finalState === "retrievalPending" ? "completed" : finalStatus;
      await sessionService.updateSessionStatus(sessionId, status as "completed" | "failed" | "cancelled");
      console.log(`[Worker] Session ${sessionId} finished with state: ${result.finalState}`);
      resolve();
    });

    controller.onError((err) => {
      console.error(`[Worker] Session ${sessionId} error:`, err);
      reject(err);
    });
  });

  // Subscribe to state changes to handle awaitingClarification
  const actor = controller.actor;
  actor.subscribe((snapshot: { value: unknown }) => {
    const state = snapshot.value;

    if (state === "awaitingClarification") {
      handleAwaitingClarification(sessionId, controller, job).catch((err) => {
        console.error(`[Worker] Error handling clarification for ${sessionId}:`, err);
      });
    }
  });

  // Start the workflow
  controller.start();

  // Wait for completion
  await completionPromise;
}

async function handleAwaitingClarification(
  sessionId: string,
  controller: ReturnType<typeof createWorkflowController>,
  job: Job
): Promise<void> {
  // Update session status to awaiting_input
  await sessionService.updateSessionStatus(sessionId, "awaiting_input");

  // Subscribe to Redis channel for user response
  const subscriber = createRedisConnection();
  const channel = `research:${sessionId}:response`;

  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(async () => {
      await subscriber.unsubscribe();
      subscriber.disconnect();
      controller.cancel();
      reject(new Error(`Clarification timeout for session ${sessionId}`));
    }, CLARIFICATION_TIMEOUT_MS);

    subscriber.subscribe(channel).then(() => {
      subscriber.on("message", async (_ch: string, message: string) => {
        clearTimeout(timeout);
        await subscriber.unsubscribe();
        subscriber.disconnect();

        // Update session status back to in_progress
        await sessionService.updateSessionStatus(sessionId, "in_progress");

        // Send user response to workflow
        controller.sendUserResponse(message);
        resolve();
      });
    }).catch(reject);

    // Extend job lock while waiting
    const lockExtender = setInterval(() => {
      job.extendLock(job.token ?? "", 30_000).catch(() => {
        // If lock extension fails, the job might have been moved
        clearInterval(lockExtender);
      });
    }, 20_000);

    // Clean up lock extender on resolution
    const originalResolve = resolve;
    const cleanup = () => {
      clearInterval(lockExtender);
      clearTimeout(timeout);
    };

    subscriber.on("message", () => cleanup());
  });
}

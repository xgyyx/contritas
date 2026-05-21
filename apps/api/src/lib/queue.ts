import { Queue } from "bullmq";
import { getRedis } from "./redis.js";

export interface ResearchJobData {
  sessionId: string;
  parentSessionId?: string;
  iterationType?: "deep_dive" | "add_dimension";
  target?: string;
  details?: string;
  /**
   * The X-Request-Id (or our generated request id) of the API request that
   * enqueued this job. Worker logs include it so a single user action can be
   * correlated across api → worker → workflow logs.
   */
  requestId?: string;
}

let researchQueue: Queue<ResearchJobData> | null = null;

export function getResearchQueue(): Queue<ResearchJobData> {
  if (!researchQueue) {
    researchQueue = new Queue<ResearchJobData>("research", {
      connection: getRedis(),
      defaultJobOptions: {
        // attempts: 1 short-term — without an idempotency key, retries would
        // re-run LLM/search calls and double-bill. Long-term: cache LLM/search
        // responses keyed by (sessionId, phase, actorName) and bump back to 3.
        attempts: 1,
        backoff: { type: "exponential", delay: 5000 },
        removeOnComplete: { age: 7 * 24 * 3600 }, // 7 days
        removeOnFail: { age: 30 * 24 * 3600 }, // 30 days
      },
    });
  }
  return researchQueue;
}

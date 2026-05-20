import { Worker } from "bullmq";
import { getRedis, closeRedis } from "./lib/redis.js";
import { processResearchJob } from "./jobs/research.job.js";
import type { ResearchJobData } from "./lib/queue.js";
import { WORKER_LOCK_DURATION_MS } from "@contritas/shared";

console.log("[Worker] Starting Contritas research worker...");

const worker = new Worker<ResearchJobData>(
  "research",
  async (job) => {
    await processResearchJob(job);
  },
  {
    connection: getRedis(),
    concurrency: 3,
    lockDuration: WORKER_LOCK_DURATION_MS, // 30 minutes for long-running research
  }
);

worker.on("completed", (job) => {
  console.log(`[Worker] Job ${job.id} completed`);
});

worker.on("failed", (job, err) => {
  console.error(`[Worker] Job ${job?.id} failed:`, err.message);
});

worker.on("error", (err) => {
  console.error("[Worker] Worker error:", err);
});

// Graceful shutdown
async function shutdown(signal: string) {
  console.log(`[Worker] Received ${signal}, shutting down...`);
  await worker.close();
  await closeRedis();
  console.log("[Worker] Shutdown complete.");
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

console.log("[Worker] Worker ready, waiting for jobs...");

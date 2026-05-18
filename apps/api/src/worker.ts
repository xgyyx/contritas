import { Worker } from "bullmq";
import { getRedis } from "./lib/redis.js";
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
process.on("SIGTERM", async () => {
  console.log("[Worker] Received SIGTERM, shutting down...");
  await worker.close();
  process.exit(0);
});

process.on("SIGINT", async () => {
  console.log("[Worker] Received SIGINT, shutting down...");
  await worker.close();
  process.exit(0);
});

console.log("[Worker] Worker ready, waiting for jobs...");

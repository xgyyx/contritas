import { Worker } from "bullmq";
import { getRedis, closeRedis } from "./lib/redis.js";
import { processResearchJob } from "./jobs/research.job.js";
import type { ResearchJobData } from "./lib/queue.js";
import { WORKER_LOCK_DURATION_MS } from "@contritas/shared";
import { createLogger } from "./lib/logger.js";

const log = createLogger("worker");
log.info("starting Contritas research worker");

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
  log.info({ jobId: job.id, sessionId: job.data?.sessionId }, "job completed");
});

worker.on("failed", (job, err) => {
  log.error(
    { jobId: job?.id, sessionId: job?.data?.sessionId, err: err.message },
    "job failed"
  );
});

worker.on("error", (err) => {
  log.error({ err }, "worker error");
});

// Graceful shutdown
async function shutdown(signal: string) {
  log.info({ signal }, "received signal, shutting down");
  await worker.close();
  await closeRedis();
  log.info("shutdown complete");
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

log.info("worker ready, waiting for jobs");

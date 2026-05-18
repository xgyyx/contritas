import { Queue } from "bullmq";
import { getRedis } from "./redis.js";

export interface ResearchJobData {
  sessionId: string;
}

let researchQueue: Queue<ResearchJobData> | null = null;

export function getResearchQueue(): Queue<ResearchJobData> {
  if (!researchQueue) {
    researchQueue = new Queue<ResearchJobData>("research", {
      connection: getRedis(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 5000 },
        removeOnComplete: { age: 7 * 24 * 3600 }, // 7 days
        removeOnFail: { age: 30 * 24 * 3600 }, // 30 days
      },
    });
  }
  return researchQueue;
}

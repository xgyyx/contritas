import type { ProgressEvent } from "@contritas/shared";
import { getRedis, createRedisConnection } from "../lib/redis.js";

const EVENT_TTL_SECONDS = 7 * 24 * 3600; // 7 days

export async function publishEvent(sessionId: string, event: ProgressEvent): Promise<void> {
  const redis = getRedis();
  const data = JSON.stringify(event);

  // Add to Redis Stream for catchup
  await redis.xadd(
    `events:${sessionId}`,
    "*",
    "data",
    data
  );

  // Set TTL on the stream key
  await redis.expire(`events:${sessionId}`, EVENT_TTL_SECONDS);

  // Publish to PubSub channel for real-time
  await redis.publish(`research:${sessionId}:events`, data);
}

export async function getEventHistory(
  sessionId: string,
  fromId: string = "-"
): Promise<Array<{ id: string; data: string }>> {
  const redis = getRedis();

  const entries = await redis.xrange(`events:${sessionId}`, fromId, "+");

  return entries.map((entry) => ({
    id: entry[0],
    data: entry[1][1], // fields is [key, value, ...], we stored "data" as key
  }));
}

export function createSubscriber(sessionId: string) {
  const subscriber = createRedisConnection();

  return {
    subscriber,
    channel: `research:${sessionId}:events`,
    async subscribe(callback: (data: string) => void): Promise<void> {
      await subscriber.subscribe(`research:${sessionId}:events`);
      subscriber.on("message", (_channel: string, message: string) => {
        callback(message);
      });
    },
    async unsubscribe(): Promise<void> {
      await subscriber.unsubscribe();
      subscriber.disconnect();
    },
  };
}

// Publish user response to worker
export async function publishUserResponse(sessionId: string, response: string): Promise<void> {
  const redis = getRedis();
  await redis.publish(`research:${sessionId}:response`, response);
}

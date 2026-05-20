import type { ProgressEvent } from "@contritas/shared";
import { getRedis, createRedisConnection } from "../lib/redis.js";

const EVENT_TTL_SECONDS = 7 * 24 * 3600; // 7 days
const SUBSCRIBER_BUFFER_LIMIT = 1000;

export interface BufferedEvent {
  id: string;
  data: string;
}

export async function publishEvent(sessionId: string, event: ProgressEvent): Promise<void> {
  const redis = getRedis();
  const data = JSON.stringify(event);

  // Persist to Redis Stream first so xadd assigns the canonical id, then
  // broadcast both id and payload — subscribers use the id to dedup against
  // the catchup history they read on connect.
  const id = await redis.xadd(`events:${sessionId}`, "*", "data", data);

  await redis.expire(`events:${sessionId}`, EVENT_TTL_SECONDS);

  await redis.publish(
    `research:${sessionId}:events`,
    JSON.stringify({ id, data })
  );
}

export async function getEventHistory(
  sessionId: string,
  fromId: string = "-"
): Promise<BufferedEvent[]> {
  const redis = getRedis();

  const entries = await redis.xrange(`events:${sessionId}`, fromId, "+");

  return entries.map((entry) => ({
    id: entry[0],
    data: entry[1][1], // fields is [key, value, ...], we stored "data" as key
  }));
}

/**
 * Returns "id1 < id2" using Redis stream id ordering ("ms-seq").
 * Strings compare lexicographically only when zero-padded; we instead split
 * on "-" and compare numerically.
 */
function streamIdLessOrEqual(a: string, b: string): boolean {
  const [aMs, aSeq] = a.split("-").map((s) => Number(s));
  const [bMs, bSeq] = b.split("-").map((s) => Number(s));
  if (aMs !== bMs) return aMs < bMs;
  return aSeq <= bSeq;
}

/**
 * Subscriber that prevents the catchup race: it immediately subscribes to the
 * pub/sub channel and buffers every incoming message. The caller then reads
 * stream history, sets a handler, and the subscriber drains buffered messages
 * (dedup'd against the history's last id) before switching to live delivery.
 */
export function createSubscriber(sessionId: string) {
  const subscriber = createRedisConnection();
  const channel = `research:${sessionId}:events`;

  const buffer: BufferedEvent[] = [];
  let dropped = 0;
  let handler: ((event: BufferedEvent) => void | Promise<void>) | null = null;
  let subscribed = false;

  const onMessage = (_ch: string, message: string) => {
    let parsed: BufferedEvent;
    try {
      const raw = JSON.parse(message);
      if (typeof raw?.id === "string" && typeof raw?.data === "string") {
        parsed = { id: raw.id, data: raw.data };
      } else {
        // Legacy publishers may send raw JSON payload only — synthesize a
        // monotonically increasing local id so dedup still works.
        parsed = { id: `local-${Date.now()}-${Math.random()}`, data: message };
      }
    } catch {
      parsed = { id: `local-${Date.now()}-${Math.random()}`, data: message };
    }

    if (handler) {
      void handler(parsed);
      return;
    }
    if (buffer.length >= SUBSCRIBER_BUFFER_LIMIT) {
      dropped++;
      return;
    }
    buffer.push(parsed);
  };

  return {
    /**
     * Begin buffering pub/sub messages immediately. Call before reading
     * history to close the gap between history snapshot and live delivery.
     */
    async start(): Promise<void> {
      if (subscribed) return;
      subscriber.on("message", onMessage);
      await subscriber.subscribe(channel);
      subscribed = true;
    },

    /**
     * Switch from buffering to live delivery. Drains buffered events, skipping
     * anything already covered by the catchup snapshot (lastSeenId).
     */
    async drainAndAttach(
      lastSeenId: string | undefined,
      cb: (event: BufferedEvent) => void | Promise<void>
    ): Promise<{ dropped: number }> {
      const drainList = buffer.splice(0, buffer.length);
      handler = cb;

      for (const event of drainList) {
        if (lastSeenId && streamIdLessOrEqual(event.id, lastSeenId)) continue;
        await cb(event);
      }

      return { dropped };
    },

    async unsubscribe(): Promise<void> {
      handler = null;
      try {
        if (subscribed) await subscriber.unsubscribe(channel);
      } catch {
        // ignore — connection may already be closing
      }
      try {
        await subscriber.quit();
      } catch {
        subscriber.disconnect();
      }
    },
  };
}

// Publish user response to worker
export async function publishUserResponse(sessionId: string, response: string): Promise<void> {
  const redis = getRedis();
  await redis.publish(`research:${sessionId}:response`, response);
}

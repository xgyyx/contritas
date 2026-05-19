import { createHash } from "node:crypto";
import type { SearchCache, SearchResult } from "./types.js";

export interface RedisLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ...args: unknown[]): Promise<unknown>;
}

export class RedisSearchCache implements SearchCache {
  private readonly redis: RedisLike;
  private readonly keyPrefix: string;

  constructor(redis: RedisLike, keyPrefix = "search:cache:") {
    this.redis = redis;
    this.keyPrefix = keyPrefix;
  }

  async get(key: string): Promise<SearchResult[] | null> {
    try {
      const cached = await this.redis.get(this.buildKey(key));
      if (!cached) return null;
      return JSON.parse(cached) as SearchResult[];
    } catch {
      return null;
    }
  }

  async set(key: string, results: SearchResult[], ttlSeconds: number): Promise<void> {
    try {
      await this.redis.set(
        this.buildKey(key),
        JSON.stringify(results),
        "EX",
        ttlSeconds
      );
    } catch {
      // Graceful degradation — cache write failure should not break search
    }
  }

  private buildKey(raw: string): string {
    const hash = createHash("sha256").update(raw).digest("hex").slice(0, 16);
    return `${this.keyPrefix}${hash}`;
  }
}

export function buildCacheKey(query: string, language: string): string {
  return `${language}:${query}`;
}

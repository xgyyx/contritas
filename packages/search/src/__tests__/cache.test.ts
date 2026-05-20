import { describe, it, expect } from "vitest";
import { RedisSearchCache, RedisContentCache, buildCacheKey } from "../cache.js";
import { SessionCallCounter } from "../rate-limiter.js";
import { URLDeduplicator } from "../deduplicator.js";

// Mock Redis-like object for testing
function createMockRedis() {
  const store = new Map<string, { value: string; expiresAt?: number }>();
  return {
    get: async (key: string) => {
      const entry = store.get(key);
      if (!entry) return null;
      if (entry.expiresAt && Date.now() > entry.expiresAt) {
        store.delete(key);
        return null;
      }
      return entry.value;
    },
    set: async (key: string, value: string, ...args: unknown[]) => {
      const exFlag = args[0] as string | undefined;
      const ttl = args[1] as number | undefined;
      store.set(key, {
        value,
        expiresAt: exFlag === "EX" && ttl ? Date.now() + ttl * 1000 : undefined,
      });
      return "OK";
    },
    _store: store,
  };
}

describe("RedisSearchCache", () => {
  it("returns null on cache miss", async () => {
    const redis = createMockRedis();
    const cache = new RedisSearchCache(redis);

    const result = await cache.get("nonexistent");
    expect(result).toBeNull();
  });

  it("stores and retrieves search results", async () => {
    const redis = createMockRedis();
    const cache = new RedisSearchCache(redis);

    const results = [
      { url: "https://example.com", title: "Test", snippet: "Hello" },
    ];

    await cache.set("test-key", results, 3600);
    const retrieved = await cache.get("test-key");

    expect(retrieved).toEqual(results);
  });

  it("handles Redis errors gracefully on get", async () => {
    const redis = {
      get: async () => { throw new Error("Connection refused"); },
      set: async () => "OK",
    };
    const cache = new RedisSearchCache(redis);

    const result = await cache.get("key");
    expect(result).toBeNull();
  });

  it("handles Redis errors gracefully on set", async () => {
    const redis = {
      get: async () => null,
      set: async () => { throw new Error("Connection refused"); },
    };
    const cache = new RedisSearchCache(redis);

    // Should not throw
    await cache.set("key", [], 3600);
  });
});

describe("buildCacheKey", () => {
  it("includes language in key", () => {
    const key1 = buildCacheKey("query", "zh");
    const key2 = buildCacheKey("query", "en");
    expect(key1).not.toBe(key2);
  });

  it("includes provider in key when specified", () => {
    const key1 = buildCacheKey("query", "zh", "tavily");
    const key2 = buildCacheKey("query", "zh", "serper");
    const key3 = buildCacheKey("query", "zh");
    expect(key1).not.toBe(key2);
    expect(key1).not.toBe(key3);
    expect(key1).toBe("tavily:zh:query");
  });
});

describe("RedisContentCache", () => {
  it("returns null on cache miss", async () => {
    const redis = createMockRedis();
    const cache = new RedisContentCache(redis);

    const result = await cache.get("https://example.com");
    expect(result).toBeNull();
  });

  it("stores and retrieves content", async () => {
    const redis = createMockRedis();
    const cache = new RedisContentCache(redis);

    const content = {
      url: "https://example.com",
      title: "Test",
      content: "Hello world",
      wordCount: 2,
      success: true,
    };

    await cache.set("https://example.com", content, 3600);
    const retrieved = await cache.get("https://example.com");

    expect(retrieved).toEqual(content);
  });

  it("handles Redis errors gracefully", async () => {
    const redis = {
      get: async () => { throw new Error("Connection refused"); },
      set: async () => "OK",
    };
    const cache = new RedisContentCache(redis);

    const result = await cache.get("https://example.com");
    expect(result).toBeNull();
  });
});

describe("SessionCallCounter", () => {
  it("tracks call count", () => {
    const counter = new SessionCallCounter(10);
    expect(counter.used).toBe(0);
    expect(counter.remaining).toBe(10);

    counter.increment();
    expect(counter.used).toBe(1);
    expect(counter.remaining).toBe(9);
  });

  it("throws when limit reached", () => {
    const counter = new SessionCallCounter(2);
    counter.increment();
    counter.increment();

    expect(() => counter.increment()).toThrow("limit reached");
    expect(counter.exhausted).toBe(true);
  });

  it("reports exhausted correctly", () => {
    const counter = new SessionCallCounter(1);
    expect(counter.exhausted).toBe(false);
    counter.increment();
    expect(counter.exhausted).toBe(true);
  });
});

describe("URLDeduplicator", () => {
  it("detects duplicate URLs", () => {
    const dedup = new URLDeduplicator();
    dedup.add("https://example.com/page");

    expect(dedup.isDuplicate("https://example.com/page")).toBe(true);
    expect(dedup.isDuplicate("https://example.com/other")).toBe(false);
  });

  it("normalizes trailing slashes", () => {
    const dedup = new URLDeduplicator();
    dedup.add("https://example.com/page/");

    expect(dedup.isDuplicate("https://example.com/page")).toBe(true);
  });

  it("strips tracking parameters", () => {
    const dedup = new URLDeduplicator();
    dedup.add("https://example.com/page?utm_source=google&ref=twitter");

    expect(dedup.isDuplicate("https://example.com/page")).toBe(true);
  });

  it("treats different hosts as different", () => {
    const dedup = new URLDeduplicator();
    dedup.add("https://a.com/page");

    expect(dedup.isDuplicate("https://b.com/page")).toBe(false);
  });

  it("is case-insensitive for hosts", () => {
    const dedup = new URLDeduplicator();
    dedup.add("https://Example.COM/page");

    expect(dedup.isDuplicate("https://example.com/page")).toBe(true);
  });

  it("tracks size", () => {
    const dedup = new URLDeduplicator();
    expect(dedup.size).toBe(0);
    dedup.add("https://a.com");
    dedup.add("https://b.com");
    expect(dedup.size).toBe(2);
  });
});

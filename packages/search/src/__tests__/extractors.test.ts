import { describe, it, expect, vi, beforeEach } from "vitest";
import { JinaExtractor } from "../extractors/jina.js";
import { FallbackExtractorChain } from "../extractors/fallback-chain.js";
import type { ContentExtractor, ExtractedContent } from "../types.js";

describe("JinaExtractor", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("extracts markdown content from Jina", async () => {
    const markdown = "# Title Here\n\nSome content about the topic.";
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(markdown, { status: 200 })
    );

    const extractor = new JinaExtractor();
    const result = await extractor.extract("https://example.com/page");

    expect(result.success).toBe(true);
    expect(result.title).toBe("Title Here");
    expect(result.content).toBe(markdown);
    expect(result.wordCount).toBeGreaterThan(0);
  });

  it("returns failure on HTTP error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("Not found", { status: 404 })
    );

    const extractor = new JinaExtractor();
    const result = await extractor.extract("https://example.com/missing");

    expect(result.success).toBe(false);
    expect(result.error).toContain("404");
  });

  it("includes Authorization header when API key provided", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("content", { status: 200 })
    );

    const extractor = new JinaExtractor("my-jina-key");
    await extractor.extract("https://example.com");

    const headers = (fetchSpy.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer my-jina-key");
  });

  it("handles fetch errors gracefully", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("Network error"));

    const extractor = new JinaExtractor();
    const result = await extractor.extract("https://example.com");

    expect(result.success).toBe(false);
    expect(result.error).toBe("Network error");
  });
});

describe("FallbackExtractorChain", () => {
  it("returns first successful result", async () => {
    const failExtractor: ContentExtractor = {
      name: "fail",
      extract: async () => ({ url: "", title: "", content: "", wordCount: 0, success: false, error: "failed" }),
    };
    const successExtractor: ContentExtractor = {
      name: "success",
      extract: async (url) => ({ url, title: "T", content: "Content", wordCount: 1, success: true }),
    };

    const chain = new FallbackExtractorChain([failExtractor, successExtractor]);
    const result = await chain.extract("https://example.com");

    expect(result.success).toBe(true);
    expect(result.content).toBe("Content");
  });

  it("returns failure when all extractors fail", async () => {
    const fail1: ContentExtractor = {
      name: "fail1",
      extract: async () => ({ url: "", title: "", content: "", wordCount: 0, success: false, error: "Error 1" }),
    };
    const fail2: ContentExtractor = {
      name: "fail2",
      extract: async () => ({ url: "", title: "", content: "", wordCount: 0, success: false, error: "Error 2" }),
    };

    const chain = new FallbackExtractorChain([fail1, fail2]);
    const result = await chain.extract("https://example.com");

    expect(result.success).toBe(false);
    expect(result.error).toContain("Error 2");
  });

  it("throws if constructed with empty list", () => {
    expect(() => new FallbackExtractorChain([])).toThrow("requires at least one");
  });

  it("skips extractors that return empty content", async () => {
    const emptyExtractor: ContentExtractor = {
      name: "empty",
      extract: async (url) => ({ url, title: "T", content: "", wordCount: 0, success: true }),
    };
    const goodExtractor: ContentExtractor = {
      name: "good",
      extract: async (url) => ({ url, title: "Good", content: "Real content", wordCount: 2, success: true }),
    };

    const chain = new FallbackExtractorChain([emptyExtractor, goodExtractor]);
    const result = await chain.extract("https://example.com");

    expect(result.title).toBe("Good");
    expect(result.content).toBe("Real content");
  });
});

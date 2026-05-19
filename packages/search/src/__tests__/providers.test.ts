import { describe, it, expect, vi, beforeEach } from "vitest";
import { TavilySearchProvider } from "../providers/tavily.js";
import { SerperSearchProvider } from "../providers/serper.js";

describe("TavilySearchProvider", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("maps Tavily response to SearchResult[]", async () => {
    const mockResponse = {
      results: [
        { url: "https://example.com/1", title: "Result 1", content: "Snippet 1", score: 0.95 },
        { url: "https://example.com/2", title: "Result 2", content: "Snippet 2", score: 0.85 },
      ],
    };

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(mockResponse), { status: 200 })
    );

    const provider = new TavilySearchProvider("test-key");
    const results = await provider.search({ query: "test query", language: "en" });

    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({
      url: "https://example.com/1",
      title: "Result 1",
      snippet: "Snippet 1",
      score: 0.95,
    });
  });

  it("throws on 401 error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("Unauthorized", { status: 401 })
    );

    const provider = new TavilySearchProvider("bad-key");
    await expect(provider.search({ query: "test", language: "en" }))
      .rejects.toThrow("Tavily authentication failed");
  });

  it("throws on 429 rate limit", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("Rate limited", { status: 429 })
    );

    const provider = new TavilySearchProvider("test-key");
    await expect(provider.search({ query: "test", language: "en" }))
      .rejects.toThrow("Tavily rate limit exceeded");
  });

  it("sends correct request body", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ results: [] }), { status: 200 })
    );

    const provider = new TavilySearchProvider("my-key");
    await provider.search({ query: "AI research", language: "zh", maxResults: 5 });

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://api.tavily.com/search",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          api_key: "my-key",
          query: "AI research",
          search_depth: "advanced",
          max_results: 5,
          include_answer: false,
          include_raw_content: false,
        }),
      })
    );
  });
});

describe("SerperSearchProvider", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("maps Serper organic results to SearchResult[]", async () => {
    const mockResponse = {
      organic: [
        { link: "https://example.com/a", title: "A", snippet: "Snippet A", position: 1 },
        { link: "https://example.com/b", title: "B", snippet: "Snippet B", position: 2 },
      ],
    };

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(mockResponse), { status: 200 })
    );

    const provider = new SerperSearchProvider("test-key");
    const results = await provider.search({ query: "test", language: "en" });

    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({
      url: "https://example.com/a",
      title: "A",
      snippet: "Snippet A",
      score: 0.9,
    });
  });

  it("sends gl=cn for Chinese language", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ organic: [] }), { status: 200 })
    );

    const provider = new SerperSearchProvider("test-key");
    await provider.search({ query: "人工智能", language: "zh" });

    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(body.gl).toBe("cn");
    expect(body.hl).toBe("zh-cn");
  });

  it("throws on 401 error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("Unauthorized", { status: 401 })
    );

    const provider = new SerperSearchProvider("bad-key");
    await expect(provider.search({ query: "test", language: "en" }))
      .rejects.toThrow("Serper authentication failed");
  });
});

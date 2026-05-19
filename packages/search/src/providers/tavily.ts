import type { SearchProvider, SearchParams, SearchResult } from "../types.js";

interface TavilySearchResponse {
  results: Array<{
    url: string;
    title: string;
    content: string;
    score: number;
  }>;
}

export class TavilySearchProvider implements SearchProvider {
  readonly name = "tavily";
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(apiKey: string, baseUrl = "https://api.tavily.com") {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
  }

  async search(params: SearchParams): Promise<SearchResult[]> {
    const response = await fetch(`${this.baseUrl}/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: this.apiKey,
        query: params.query,
        search_depth: params.searchDepth ?? "advanced",
        max_results: params.maxResults ?? 10,
        include_answer: false,
        include_raw_content: false,
      }),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      if (response.status === 401) {
        throw new Error(`Tavily authentication failed: ${text}`);
      }
      if (response.status === 429) {
        throw new Error(`Tavily rate limit exceeded: ${text}`);
      }
      throw new Error(`Tavily search failed (${response.status}): ${text}`);
    }

    const data = (await response.json()) as TavilySearchResponse;

    return data.results.map((r) => ({
      url: r.url,
      title: r.title,
      snippet: r.content,
      score: r.score,
    }));
  }
}

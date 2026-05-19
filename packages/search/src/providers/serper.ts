import type { SearchProvider, SearchParams, SearchResult } from "../types.js";

interface SerperResponse {
  organic: Array<{
    link: string;
    title: string;
    snippet: string;
    position: number;
  }>;
}

export class SerperSearchProvider implements SearchProvider {
  readonly name = "serper";
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(apiKey: string, baseUrl = "https://google.serper.dev") {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
  }

  async search(params: SearchParams): Promise<SearchResult[]> {
    const response = await fetch(`${this.baseUrl}/search`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-KEY": this.apiKey,
      },
      body: JSON.stringify({
        q: params.query,
        num: params.maxResults ?? 10,
        gl: params.language === "zh" ? "cn" : "us",
        hl: params.language === "zh" ? "zh-cn" : "en",
      }),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      if (response.status === 401) {
        throw new Error(`Serper authentication failed: ${text}`);
      }
      if (response.status === 429) {
        throw new Error(`Serper rate limit exceeded: ${text}`);
      }
      throw new Error(`Serper search failed (${response.status}): ${text}`);
    }

    const data = (await response.json()) as SerperResponse;

    return (data.organic ?? []).map((r) => ({
      url: r.link,
      title: r.title,
      snippet: r.snippet,
      score: 1 - r.position / 10,
    }));
  }
}

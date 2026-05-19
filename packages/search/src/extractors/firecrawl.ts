import type { ContentExtractor, ExtractedContent } from "../types.js";

interface FirecrawlResponse {
  success: boolean;
  data?: {
    markdown: string;
    metadata?: {
      title?: string;
      publishedDate?: string;
    };
  };
  error?: string;
}

export class FirecrawlExtractor implements ContentExtractor {
  readonly name = "firecrawl";
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(apiKey: string, baseUrl = "https://api.firecrawl.dev", timeoutMs = 30000) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
    this.timeoutMs = timeoutMs;
  }

  async extract(url: string): Promise<ExtractedContent> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}/v1/scrape`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          url,
          formats: ["markdown"],
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        return {
          url,
          title: "",
          content: "",
          wordCount: 0,
          success: false,
          error: `Firecrawl extraction failed (${response.status})`,
        };
      }

      const data = (await response.json()) as FirecrawlResponse;

      if (!data.success || !data.data) {
        return {
          url,
          title: "",
          content: "",
          wordCount: 0,
          success: false,
          error: data.error ?? "Firecrawl returned no data",
        };
      }

      const content = data.data.markdown;
      const wordCount = content.split(/\s+/).length;

      return {
        url,
        title: data.data.metadata?.title ?? "",
        content,
        publishedDate: data.data.metadata?.publishedDate,
        wordCount,
        success: true,
      };
    } catch (err) {
      return {
        url,
        title: "",
        content: "",
        wordCount: 0,
        success: false,
        error: err instanceof Error ? err.message : "Firecrawl extraction failed",
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}

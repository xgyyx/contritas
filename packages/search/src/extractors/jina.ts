import type { ContentExtractor, ExtractedContent } from "../types.js";

export class JinaExtractor implements ContentExtractor {
  readonly name = "jina";
  private readonly apiKey?: string;
  private readonly timeoutMs: number;

  constructor(apiKey?: string, timeoutMs = 15000) {
    this.apiKey = apiKey;
    this.timeoutMs = timeoutMs;
  }

  async extract(url: string): Promise<ExtractedContent> {
    const headers: Record<string, string> = {
      Accept: "text/markdown",
    };
    if (this.apiKey) {
      headers["Authorization"] = `Bearer ${this.apiKey}`;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(`https://r.jina.ai/${url}`, {
        headers,
        signal: controller.signal,
      });

      if (!response.ok) {
        return {
          url,
          title: "",
          content: "",
          wordCount: 0,
          success: false,
          error: `Jina extraction failed (${response.status})`,
        };
      }

      const content = await response.text();
      const title = this.extractTitle(content) ?? url;
      const wordCount = content.split(/\s+/).length;

      return {
        url,
        title,
        content,
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
        error: err instanceof Error ? err.message : "Jina extraction failed",
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  private extractTitle(markdown: string): string | undefined {
    const match = markdown.match(/^#\s+(.+)$/m);
    return match?.[1]?.trim();
  }
}

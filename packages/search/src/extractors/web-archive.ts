import type { ContentExtractor, ExtractedContent } from "../types.js";
import { JinaExtractor } from "./jina.js";
import { assertSafePublicUrl, UnsafeUrlError } from "../utils/url-safety.js";

interface WaybackAvailabilityResponse {
  archived_snapshots: {
    closest?: {
      url: string;
      status: string;
      available: boolean;
      timestamp: string;
    };
  };
}

export class WebArchiveExtractor implements ContentExtractor {
  readonly name = "web-archive";
  private readonly jinaExtractor: JinaExtractor;
  private readonly timeoutMs: number;

  constructor(jinaApiKey?: string, timeoutMs = 20000) {
    this.jinaExtractor = new JinaExtractor(jinaApiKey, timeoutMs);
    this.timeoutMs = timeoutMs;
  }

  async extract(url: string): Promise<ExtractedContent> {
    try {
      await assertSafePublicUrl(url);
    } catch (err) {
      if (err instanceof UnsafeUrlError) {
        return {
          url,
          title: "",
          content: "",
          wordCount: 0,
          success: false,
          error: err.message,
        };
      }
      throw err;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      // Check Wayback Machine availability
      const checkResponse = await fetch(
        `https://archive.org/wayback/available?url=${encodeURIComponent(url)}`,
        { signal: controller.signal }
      );

      if (!checkResponse.ok) {
        return {
          url,
          title: "",
          content: "",
          wordCount: 0,
          success: false,
          error: `Web Archive availability check failed (${checkResponse.status})`,
        };
      }

      const data = (await checkResponse.json()) as WaybackAvailabilityResponse;
      const snapshot = data.archived_snapshots.closest;

      if (!snapshot?.available) {
        return {
          url,
          title: "",
          content: "",
          wordCount: 0,
          success: false,
          error: "No archived snapshot available",
        };
      }

      // Use Jina to extract the archived page
      return await this.jinaExtractor.extract(snapshot.url);
    } catch (err) {
      return {
        url,
        title: "",
        content: "",
        wordCount: 0,
        success: false,
        error: err instanceof Error ? err.message : "Web Archive extraction failed",
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}

import type { ContentExtractor, ExtractedContent } from "../types.js";

export class FallbackExtractorChain implements ContentExtractor {
  readonly name = "fallback-chain";
  private readonly extractors: ContentExtractor[];

  constructor(extractors: ContentExtractor[]) {
    if (extractors.length === 0) {
      throw new Error("FallbackExtractorChain requires at least one extractor");
    }
    this.extractors = extractors;
  }

  async extract(url: string): Promise<ExtractedContent> {
    let lastError = "";

    for (const extractor of this.extractors) {
      const result = await extractor.extract(url);
      if (result.success && result.content.length > 0) {
        return result;
      }
      lastError = result.error ?? `${extractor.name} returned empty content`;
    }

    return {
      url,
      title: "",
      content: "",
      wordCount: 0,
      success: false,
      error: `All extractors failed. Last error: ${lastError}`,
    };
  }
}

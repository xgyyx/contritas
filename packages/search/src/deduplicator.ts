export class URLDeduplicator {
  private readonly seen = new Set<string>();

  isDuplicate(url: string): boolean {
    const normalized = this.normalize(url);
    return this.seen.has(normalized);
  }

  add(url: string): void {
    const normalized = this.normalize(url);
    this.seen.add(normalized);
  }

  get size(): number {
    return this.seen.size;
  }

  private normalize(url: string): string {
    try {
      const parsed = new URL(url);
      // Remove tracking params
      const trackingParams = [
        "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
        "fbclid", "gclid", "ref", "source",
      ];
      for (const param of trackingParams) {
        parsed.searchParams.delete(param);
      }
      // Remove trailing slash
      let pathname = parsed.pathname;
      if (pathname.length > 1 && pathname.endsWith("/")) {
        pathname = pathname.slice(0, -1);
      }
      // Remove fragment
      parsed.hash = "";
      // Lowercase host
      return `${parsed.protocol}//${parsed.host.toLowerCase()}${pathname}${parsed.search}`;
    } catch {
      return url.toLowerCase();
    }
  }
}

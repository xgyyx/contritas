import pLimit from "p-limit";
import {
  SEARCH_CONCURRENT_LIMIT,
  EXTRACT_CONCURRENT_LIMIT,
  MAX_SEARCH_CALLS_PER_SESSION,
} from "@contritas/shared";

export function createSearchLimiter() {
  return pLimit(SEARCH_CONCURRENT_LIMIT);
}

export function createExtractLimiter() {
  return pLimit(EXTRACT_CONCURRENT_LIMIT);
}

export class SessionCallCounter {
  private count = 0;
  private readonly max: number;

  constructor(max: number = MAX_SEARCH_CALLS_PER_SESSION) {
    this.max = max;
  }

  increment(): void {
    if (this.count >= this.max) {
      throw new Error(`Session search call limit reached (${this.max})`);
    }
    this.count++;
  }

  get remaining(): number {
    return this.max - this.count;
  }

  get used(): number {
    return this.count;
  }

  get exhausted(): boolean {
    return this.count >= this.max;
  }
}

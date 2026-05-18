import type { LLMProvider } from "./types.js";
import { ClaudeProvider } from "./providers/claude.js";
import { MockProvider } from "./providers/mock.js";

export interface ProviderConfig {
  provider: "claude" | "mock";
  apiKey?: string;
  mockConfig?: {
    responses?: string[];
    structuredResponses?: unknown[];
    latencyMs?: number;
  };
}

export function createProvider(config: ProviderConfig): LLMProvider {
  switch (config.provider) {
    case "claude":
      if (!config.apiKey) {
        throw new Error("API key is required for Claude provider");
      }
      return new ClaudeProvider(config.apiKey);

    case "mock":
      return new MockProvider(config.mockConfig);

    default:
      throw new Error(`Unknown provider: ${config.provider}`);
  }
}

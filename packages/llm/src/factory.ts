import type { LLMProvider } from "./types.js";
import { ClaudeProvider } from "./providers/claude.js";
import { OpenAICompatibleProvider } from "./providers/openai-compatible.js";
import { MockProvider } from "./providers/mock.js";

export interface ProviderConfig {
  provider: "claude" | "openai-compatible" | "mock";
  apiKey?: string;
  baseUrl?: string;
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
      return new ClaudeProvider(config.apiKey, config.baseUrl);

    case "openai-compatible":
      if (!config.apiKey) {
        throw new Error("API key is required for OpenAI compatible provider");
      }
      if (!config.baseUrl) {
        throw new Error("Base URL is required for OpenAI compatible provider");
      }
      return new OpenAICompatibleProvider({
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
      });

    case "mock":
      return new MockProvider(config.mockConfig);

    default:
      throw new Error(`Unknown provider: ${config.provider}`);
  }
}

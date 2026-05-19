import type { ProviderConfig } from "@contritas/llm";

export interface AppConfig {
  databaseUrl: string;
  redisUrl: string;
  llmProvider: ProviderConfig;
  port: number;
}

export function loadConfig(): AppConfig {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL environment variable is required");
  }

  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    throw new Error("REDIS_URL environment variable is required");
  }

  const llmProvider = loadLLMConfig();

  return {
    databaseUrl,
    redisUrl,
    llmProvider,
    port: parseInt(process.env.PORT ?? "4000", 10),
  };
}

function loadLLMConfig(): ProviderConfig {
  const provider = (process.env.LLM_PROVIDER ?? "claude") as ProviderConfig["provider"];

  switch (provider) {
    case "claude": {
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        throw new Error("ANTHROPIC_API_KEY is required when LLM_PROVIDER=claude");
      }
      return {
        provider: "claude",
        apiKey,
        baseUrl: process.env.ANTHROPIC_BASE_URL || undefined,
      };
    }

    case "openai-compatible": {
      const apiKey = process.env.OPENAI_COMPATIBLE_API_KEY;
      if (!apiKey) {
        throw new Error("OPENAI_COMPATIBLE_API_KEY is required when LLM_PROVIDER=openai-compatible");
      }
      const baseUrl = process.env.OPENAI_COMPATIBLE_BASE_URL;
      if (!baseUrl) {
        throw new Error("OPENAI_COMPATIBLE_BASE_URL is required when LLM_PROVIDER=openai-compatible");
      }
      return {
        provider: "openai-compatible",
        apiKey,
        baseUrl,
      };
    }

    default:
      throw new Error(`Unknown LLM_PROVIDER: ${provider}. Supported: claude, openai-compatible`);
  }
}

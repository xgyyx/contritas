import type { ProviderConfig } from "@contritas/llm";

export interface SearchConfig {
  tavilyApiKey?: string;
  serperApiKey?: string;
  jinaApiKey?: string;
  firecrawlApiKey?: string;
}

export interface AppConfig {
  databaseUrl: string;
  redisUrl: string;
  llmProvider: ProviderConfig;
  search: SearchConfig;
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
  const search = loadSearchConfig();

  return {
    databaseUrl,
    redisUrl,
    llmProvider,
    search,
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

function loadSearchConfig(): SearchConfig {
  const config: SearchConfig = {
    tavilyApiKey: process.env.TAVILY_API_KEY || undefined,
    serperApiKey: process.env.SERPER_API_KEY || undefined,
    jinaApiKey: process.env.JINA_API_KEY || undefined,
    firecrawlApiKey: process.env.FIRECRAWL_API_KEY || undefined,
  };

  if (!config.tavilyApiKey && !config.serperApiKey) {
    console.warn("[config] No search provider API key configured (TAVILY_API_KEY or SERPER_API_KEY). Search phase will fail.");
  }

  return config;
}

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
  webOrigins: string[];
  authTokens: string[];
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
  const webOrigins = loadWebOrigins();
  const authTokens = loadAuthTokens();

  return {
    databaseUrl,
    redisUrl,
    llmProvider,
    search,
    port: parseInt(process.env.PORT ?? "4000", 10),
    webOrigins,
    authTokens,
  };
}

function loadWebOrigins(): string[] {
  const raw = process.env.WEB_ORIGIN;
  if (!raw) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("WEB_ORIGIN environment variable is required in production");
    }
    return ["http://localhost:3000"];
  }
  return raw
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
}

function loadAuthTokens(): string[] {
  const raw = process.env.API_AUTH_TOKEN;
  if (!raw) {
    throw new Error(
      "API_AUTH_TOKEN environment variable is required (comma-separated list of allowed tokens)"
    );
  }
  const tokens = raw
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  if (tokens.length === 0) {
    throw new Error("API_AUTH_TOKEN must contain at least one non-empty token");
  }
  return tokens;
}

function loadLLMConfig(): ProviderConfig {
  const provider = (process.env.LLM_PROVIDER ?? "claude") as ProviderConfig["provider"];

  switch (provider) {
    case "claude": {
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        throw new Error("ANTHROPIC_API_KEY is required when LLM_PROVIDER=claude");
      }
      const baseUrl = process.env.ANTHROPIC_BASE_URL || undefined;
      if (baseUrl) {
        try {
          const host = new URL(baseUrl).hostname;
          if (!/(^|\.)anthropic\.com$/.test(host)) {
            console.warn(
              `[config] ANTHROPIC_BASE_URL points to non-official host '${host}'. ` +
                `All Claude requests/responses will be proxied through it — ensure this is intentional.`
            );
          }
        } catch {
          console.warn(`[config] ANTHROPIC_BASE_URL is not a valid URL: ${baseUrl}`);
        }
      }
      return {
        provider: "claude",
        apiKey,
        baseUrl,
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

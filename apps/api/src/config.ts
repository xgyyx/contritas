export interface AppConfig {
  databaseUrl: string;
  redisUrl: string;
  anthropicApiKey: string;
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

  const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicApiKey) {
    throw new Error("ANTHROPIC_API_KEY environment variable is required");
  }

  return {
    databaseUrl,
    redisUrl,
    anthropicApiKey,
    port: parseInt(process.env.PORT ?? "4000", 10),
  };
}

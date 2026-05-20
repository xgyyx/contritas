// Loaded via vitest setupFiles. Configures the deterministic env that
// loadConfig() and ioredis-mock require before any application module is
// evaluated.
process.env.NODE_ENV = "test";
process.env.DATABASE_URL = process.env.DATABASE_URL ?? "postgres://test:test@localhost:5432/test";
process.env.REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
process.env.LLM_PROVIDER = process.env.LLM_PROVIDER ?? "claude";
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY ?? "test-anthropic-key";
process.env.TAVILY_API_KEY = process.env.TAVILY_API_KEY ?? "test-tavily-key";
process.env.API_AUTH_TOKEN = process.env.API_AUTH_TOKEN ?? "test-token";
process.env.WEB_ORIGIN = process.env.WEB_ORIGIN ?? "http://localhost:3000";
// Disable rate limiting noise in tests by setting a high ceiling.
process.env.RATE_LIMIT_IP_PER_MIN = process.env.RATE_LIMIT_IP_PER_MIN ?? "10000";
process.env.RATE_LIMIT_CREATE_PER_HOUR = process.env.RATE_LIMIT_CREATE_PER_HOUR ?? "10000";

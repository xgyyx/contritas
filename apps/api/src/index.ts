import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { researchRouter } from "./routes/research.js";
import { db } from "./drizzle/index.js";
import { closeDb } from "./drizzle/index.js";
import { getRedis, closeRedis } from "./lib/redis.js";
import { sql } from "drizzle-orm";

const app = new Hono();

// Middleware
app.use("*", cors());

// Health check — verifies DB and Redis connectivity
app.get("/health", async (c) => {
  const checks: { db: string; redis: string } = { db: "ok", redis: "ok" };
  let healthy = true;

  try {
    await db.execute(sql`SELECT 1`);
  } catch (err) {
    checks.db = `error: ${(err as Error).message}`;
    healthy = false;
  }

  try {
    await getRedis().ping();
  } catch (err) {
    checks.redis = `error: ${(err as Error).message}`;
    healthy = false;
  }

  const status = healthy ? "ok" : "degraded";
  return c.json(
    { status, ...checks, timestamp: new Date().toISOString() },
    healthy ? 200 : 503
  );
});

// Routes
app.route("/api/research", researchRouter);

// 404 fallback
app.notFound((c) => c.json({ error: "Not found" }, 404));

// Global error handler
app.onError((err, c) => {
  console.error("Unhandled error:", err);
  return c.json({ error: "Internal server error" }, 500);
});

// Start server
const port = parseInt(process.env.PORT ?? "4000", 10);

console.log(`Contritas API server starting on port ${port}...`);

const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Server running at http://localhost:${info.port}`);
});

// Graceful shutdown
async function shutdown(signal: string) {
  console.log(`[API] Received ${signal}, shutting down gracefully...`);
  server.close();
  await closeRedis();
  await closeDb();
  console.log("[API] Shutdown complete.");
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

export default app;

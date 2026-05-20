import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { researchRouter } from "./routes/research.js";
import { db } from "./drizzle/index.js";
import { closeDb } from "./drizzle/index.js";
import { getRedis, closeRedis } from "./lib/redis.js";
import { sql } from "drizzle-orm";
import { loadConfig } from "./config.js";

const config = loadConfig();

const app = new Hono();

// CORS — explicit allowlist via WEB_ORIGIN
app.use(
  "*",
  cors({
    origin: (origin) => {
      if (!origin) return config.webOrigins[0] ?? "";
      return config.webOrigins.includes(origin) ? origin : "";
    },
    allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
    allowHeaders: ["Authorization", "Content-Type", "Last-Event-ID"],
    credentials: false,
    maxAge: 600,
  })
);

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
const port = config.port;

console.log(`Contritas API server starting on port ${port}...`);
console.log(`[config] CORS allowlist: ${config.webOrigins.join(", ")}`);
console.log(`[config] Auth tokens configured: ${config.authTokens.length}`);

const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Server running at http://localhost:${info.port}`);
});

// Graceful shutdown
const SHUTDOWN_TIMEOUT_MS = parseInt(process.env.SHUTDOWN_TIMEOUT_MS ?? "30000", 10);
let shuttingDown = false;

async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[API] Received ${signal}, shutting down gracefully...`);

  // Force-exit if graceful shutdown stalls (e.g. long SSE connections that
  // ignore abort). This bounds container kill time below the orchestrator's
  // SIGKILL grace window.
  const forceExit = setTimeout(() => {
    console.error(`[API] Shutdown exceeded ${SHUTDOWN_TIMEOUT_MS}ms, forcing exit.`);
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  forceExit.unref();

  // 1) Stop accepting new connections and wait for in-flight requests.
  // server.close() ignores existing keep-alive / SSE sockets, so we also kick
  // idle ones immediately and force-close everything after a short grace
  // period — SSE streams would otherwise hold the close() callback forever.
  const closePromise = new Promise<void>((resolve) => {
    server.close((err) => {
      if (err) console.error("[API] server.close error:", err);
      resolve();
    });
  });
  const httpServer = server as unknown as {
    closeIdleConnections?: () => void;
    closeAllConnections?: () => void;
  };
  httpServer.closeIdleConnections?.();
  const sseGrace = setTimeout(() => httpServer.closeAllConnections?.(), 5_000);
  sseGrace.unref();
  await closePromise;
  clearTimeout(sseGrace);

  // 2) Now safe to tear down shared resources.
  try {
    await closeRedis();
  } catch (err) {
    console.error("[API] closeRedis error:", err);
  }
  try {
    await closeDb();
  } catch (err) {
    console.error("[API] closeDb error:", err);
  }

  console.log("[API] Shutdown complete.");
  clearTimeout(forceExit);
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

export default app;

import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { generateId } from "@contritas/shared";
import { researchRouter } from "./routes/research.js";
import { db } from "./drizzle/index.js";
import { closeDb } from "./drizzle/index.js";
import { getRedis, closeRedis } from "./lib/redis.js";
import { sql } from "drizzle-orm";
import { loadConfig } from "./config.js";
import { createLogger } from "./lib/logger.js";

const log = createLogger("api");
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

// Request id + structured access log. Generated once per request, exposed on the
// context (so handlers can include it in their logs) and reflected in the
// X-Request-Id response header so operators can correlate client/server logs.
app.use("*", async (c, next) => {
  const incoming = c.req.header("X-Request-Id");
  const requestId = incoming && incoming.length <= 64 ? incoming : generateId();
  c.set("requestId", requestId);
  c.header("X-Request-Id", requestId);

  const start = Date.now();
  await next();
  const duration = Date.now() - start;
  const status = c.res.status;
  const entry = {
    requestId,
    method: c.req.method,
    path: c.req.path,
    status,
    durationMs: duration,
  };
  if (status >= 500) log.error(entry, "request");
  else if (duration > 2000 || status >= 400) log.warn(entry, "request");
  else log.info(entry, "request");
});

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

// Global error handler — every internal error gets a stable id so operators can
// grep logs from a user-reported errorId without exposing stack details.
app.onError((err, c) => {
  const errorId = generateId();
  const requestId = c.get("requestId") as string | undefined;
  log.error(
    {
      errorId,
      requestId,
      err: err instanceof Error ? { message: err.message, stack: err.stack } : err,
    },
    "unhandled error"
  );
  return c.json({ error: "Internal server error", errorId }, 500);
});

// Start server
const port = config.port;

log.info({ port }, "starting Contritas API server");
log.info({ webOrigins: config.webOrigins }, "CORS allowlist");
log.info({ authTokens: config.authTokens.length }, "auth tokens configured");

const server = serve({ fetch: app.fetch, port }, (info) => {
  log.info({ port: info.port }, "server listening");
});

// Graceful shutdown
const SHUTDOWN_TIMEOUT_MS = parseInt(process.env.SHUTDOWN_TIMEOUT_MS ?? "30000", 10);
let shuttingDown = false;

async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info({ signal }, "shutting down gracefully");

  // Force-exit if graceful shutdown stalls (e.g. long SSE connections that
  // ignore abort). This bounds container kill time below the orchestrator's
  // SIGKILL grace window.
  const forceExit = setTimeout(() => {
    log.error({ timeoutMs: SHUTDOWN_TIMEOUT_MS }, "shutdown exceeded timeout, forcing exit");
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  forceExit.unref();

  // 1) Stop accepting new connections and wait for in-flight requests.
  // server.close() ignores existing keep-alive / SSE sockets, so we also kick
  // idle ones immediately and force-close everything after a short grace
  // period — SSE streams would otherwise hold the close() callback forever.
  const closePromise = new Promise<void>((resolve) => {
    server.close((err) => {
      if (err) log.error({ err }, "server.close error");
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
    log.error({ err }, "closeRedis error");
  }
  try {
    await closeDb();
  } catch (err) {
    log.error({ err }, "closeDb error");
  }

  log.info("shutdown complete");
  clearTimeout(forceExit);
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

export default app;

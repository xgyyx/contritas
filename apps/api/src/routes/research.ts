import { Hono } from "hono";
import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import { generateId, createResearchSchema, userRespondSchema, sessionIdSchema, iterateResearchSchema } from "@contritas/shared";
import { getResearchQueue } from "../lib/queue.js";
import * as sessionService from "../services/session.service.js";
import * as streamService from "../services/stream.service.js";
import { authMiddleware } from "../middleware/auth.js";
import { rateLimit, clientIp } from "../middleware/rate-limit.js";
import { createLogger } from "../lib/logger.js";

const log = createLogger("api.research");

export const researchRouter = new Hono();

const ipPerMin = parseInt(process.env.RATE_LIMIT_IP_PER_MIN ?? "60", 10);
const createPerHour = parseInt(process.env.RATE_LIMIT_CREATE_PER_HOUR ?? "10", 10);

// Auth applies to every research endpoint (SSE accepts ?token= since EventSource
// cannot set custom headers).
researchRouter.use("*", authMiddleware);

// Per-IP global limit on all research endpoints.
researchRouter.use(
  "*",
  rateLimit({
    name: "ip",
    windowSeconds: 60,
    max: ipPerMin,
    keyFor: (c) => clientIp(c),
  })
);

// Stricter limit on session-creation endpoints (create + iterate) — keyed by IP+token.
const createLimiter = rateLimit({
  name: "create",
  windowSeconds: 3600,
  max: createPerHour,
  keyFor: (c) => `${clientIp(c)}:${c.get("authTokenHash")}`,
});

/**
 * Load a session and enforce ownership: only the token that created the session
 * (matched by hash) may access it. Returns null + writes a 404 response on miss.
 */
async function loadOwnedSession(c: Context, id: string | undefined) {
  if (!id) return null;
  const session = await sessionService.getSession(id);
  if (!session) return null;
  const tokenHash = c.get("authTokenHash");
  if (session.ownerTokenHash && session.ownerTokenHash !== tokenHash) {
    return null;
  }
  return session;
}

function notFound(c: Context) {
  return c.json({ error: "Session not found" }, 404);
}

// POST /api/research — Create a new research session
researchRouter.post("/", createLimiter, async (c) => {
  const body = await c.req.json();
  const parsed = createResearchSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: "Validation failed", details: parsed.error.issues }, 400);
  }

  const sessionId = generateId();
  const { proposition, language, config } = parsed.data;

  await sessionService.createSession({
    id: sessionId,
    input: {
      originalText: proposition,
      language: language ?? "zh",
    },
    config: {
      llmProvider: config?.llmProvider ?? (process.env.LLM_PROVIDER || "claude"),
      llmModel: config?.llmModel ?? (process.env.OPENAI_COMPATIBLE_MODEL || "claude-sonnet-4-20250514"),
      searchProvider: config?.searchProvider,
    },
    ownerTokenHash: c.get("authTokenHash"),
  });

  // Enqueue research job
  const queue = getResearchQueue();
  await queue.add(
    "research",
    { sessionId, requestId: c.get("requestId") },
    { jobId: sessionId }
  );

  return c.json({ sessionId, status: "in_progress" }, 202);
});

// GET /api/research/:id — Get session status
researchRouter.get("/:id", async (c) => {
  const id = c.req.param("id");
  const parseResult = sessionIdSchema.safeParse(id);
  if (!parseResult.success) {
    return c.json({ error: "Invalid session ID" }, 400);
  }

  const owned = await loadOwnedSession(c, id);
  if (!owned) return notFound(c);

  const session = await sessionService.getSessionWithCounts(id);
  if (!session) return notFound(c);

  return c.json({
    id: session.id,
    status: session.status,
    input: session.input,
    complexity: session.complexity,
    phases: session.phases,
    tokenUsage: session.tokenUsage,
    searchCallsUsed: session.searchCallsUsed,
    assumptionCount: session.assumptionCount,
    dimensionCount: session.dimensionCount,
    evidenceCount: session.evidenceCount,
    createdAt: session.createdAt?.toISOString(),
    completedAt: session.completedAt?.toISOString(),
  });
});

// GET /api/research/:id/stream — SSE progress stream
researchRouter.get("/:id/stream", async (c) => {
  const id = c.req.param("id");
  const parseResult = sessionIdSchema.safeParse(id);
  if (!parseResult.success) {
    return c.json({ error: "Invalid session ID" }, 400);
  }

  const session = await loadOwnedSession(c, id);
  if (!session) return notFound(c);

  // Standard SSE reconnect: clients may resend their last id via the
  // Last-Event-ID header, letting us replay only what they missed.
  const lastEventIdHeader = c.req.header("Last-Event-ID");
  const lastEventIdQuery = c.req.query("lastEventId");
  const requestedFromId = lastEventIdHeader ?? lastEventIdQuery;

  return streamSSE(c, async (stream) => {
    let aborted = false;
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    const sub = streamService.createSubscriber(id);

    // Per-stream serialized writer: SSE writes must be sequential (writeSSE
    // doesn't itself queue), and we need to drop slow clients deterministically
    // rather than letting events queue unboundedly behind a stalled socket.
    const MAX_QUEUE = 200;
    const queue: Array<() => Promise<void>> = [];
    let processing = false;
    let overloaded = false;

    const enqueue = (write: () => Promise<void>) => {
      if (aborted || overloaded) return;
      if (queue.length >= MAX_QUEUE) {
        overloaded = true;
        log.warn({ sessionId: id, requestId: c.get("requestId") }, "SSE: closing stream, client too slow");
        // Force the stream to close so the client can reconnect with
        // Last-Event-ID and resume from the durable history.
        aborted = true;
        return;
      }
      queue.push(write);
      if (!processing) void drain();
    };

    const drain = async () => {
      processing = true;
      while (!aborted && queue.length > 0) {
        const fn = queue.shift()!;
        try {
          await fn();
        } catch {
          aborted = true;
          break;
        }
      }
      processing = false;
    };

    const cleanup = () => {
      aborted = true;
      if (heartbeat) clearInterval(heartbeat);
      void sub.unsubscribe();
    };

    stream.onAbort(cleanup);

    try {
      // 1. Subscribe FIRST so any event published between history read and
      //    handler attachment is buffered — closes the catchup race.
      await sub.start();

      // 2. Read durable history. Use the client's resume cursor when present.
      const fromId = requestedFromId ? `(${requestedFromId}` : "-";
      const pastEvents = await streamService.getEventHistory(id, fromId);
      let lastSeenId: string | undefined = requestedFromId ?? undefined;
      for (const event of pastEvents) {
        if (aborted) return;
        enqueue(() => stream.writeSSE({ data: event.data, id: event.id }));
        lastSeenId = event.id;
      }

      if (aborted) return;

      // 3. Drain the buffer (skipping ids already covered by history) and
      //    attach the live handler.
      await sub.drainAndAttach(lastSeenId, (event) => {
        enqueue(() => stream.writeSSE({ data: event.data, id: event.id }));
      });

      if (aborted) return;

      // 4. Heartbeat every 30s — sent as a comment so EventSource doesn't
      //    surface it as a message.
      heartbeat = setInterval(() => {
        if (aborted) return;
        enqueue(() => stream.writeSSE({ data: "", event: "heartbeat" }));
      }, 30_000);

      // Hold the stream open until the client disconnects. streamSSE would
      // otherwise resolve immediately and tear everything down.
      await new Promise<void>((resolve) => {
        const check = setInterval(() => {
          if (aborted) {
            clearInterval(check);
            resolve();
          }
        }, 1000);
      });
    } finally {
      cleanup();
    }
  });
});

// POST /api/research/:id/respond — User reply to clarification
researchRouter.post("/:id/respond", async (c) => {
  const id = c.req.param("id");
  const parseResult = sessionIdSchema.safeParse(id);
  if (!parseResult.success) {
    return c.json({ error: "Invalid session ID" }, 400);
  }

  const body = await c.req.json();
  const parsed = userRespondSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Validation failed", details: parsed.error.issues }, 400);
  }

  const session = await loadOwnedSession(c, id);
  if (!session) return notFound(c);

  if (session.status !== "awaiting_input") {
    return c.json({ error: "Session is not awaiting input" }, 409);
  }

  // Publish user response to worker via Redis
  await streamService.publishUserResponse(id, parsed.data.response);

  return c.json({ success: true });
});

// GET /api/research/:id/report — Get generated report
researchRouter.get("/:id/report", async (c) => {
  const id = c.req.param("id");
  const parseResult = sessionIdSchema.safeParse(id);
  if (!parseResult.success) {
    return c.json({ error: "Invalid session ID" }, 400);
  }

  const session = await loadOwnedSession(c, id);
  if (!session) return notFound(c);

  const report = await sessionService.getReport(id);
  if (!report) {
    return c.json({ error: "Report not yet generated" }, 404);
  }

  return c.json({
    id: report.id,
    sessionId: report.sessionId,
    version: report.version,
    markdownContent: report.markdownContent,
    overallScore: report.overallScore,
    overallVerdict: report.overallVerdict,
    charCount: report.charCount,
    sourceCount: report.sourceCount,
    generatedAt: report.generatedAt?.toISOString(),
  });
});

// GET /api/research/:id/evidence — Get all evidence for a session
researchRouter.get("/:id/evidence", async (c) => {
  const id = c.req.param("id");
  const parseResult = sessionIdSchema.safeParse(id);
  if (!parseResult.success) {
    return c.json({ error: "Invalid session ID" }, 400);
  }

  const session = await loadOwnedSession(c, id);
  if (!session) return notFound(c);

  const evidence = await sessionService.getEvidence(id);
  return c.json({ evidence });
});

// POST /api/research/:id/iterate — Iterate on a completed research session
researchRouter.post("/:id/iterate", createLimiter, async (c) => {
  const id = c.req.param("id");
  const parseResult = sessionIdSchema.safeParse(id);
  if (!parseResult.success) {
    return c.json({ error: "Invalid session ID" }, 400);
  }

  const body = await c.req.json();
  const parsed = iterateResearchSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Validation failed", details: parsed.error.issues }, 400);
  }

  const session = await loadOwnedSession(c, id);
  if (!session) return notFound(c);

  if (session.status !== "completed") {
    return c.json({ error: "Session must be completed before iterating" }, 409);
  }

  const childSessionId = generateId();
  const parentInput = session.input as { originalText: string; language: "zh" | "en" };
  const parentConfig = session.config as { llmProvider: string; llmModel: string; searchProvider?: string };

  // Create child session in DB before enqueueing
  await sessionService.createSession({
    id: childSessionId,
    input: parentInput,
    config: parentConfig,
    parentSessionId: id,
    ownerTokenHash: c.get("authTokenHash"),
  });

  const queue = getResearchQueue();
  await queue.add("research", {
    sessionId: childSessionId,
    parentSessionId: id,
    iterationType: parsed.data.type,
    target: parsed.data.target,
    details: parsed.data.details,
    requestId: c.get("requestId"),
  }, { jobId: childSessionId });

  return c.json({ sessionId: childSessionId, status: "in_progress" }, 202);
});

// DELETE /api/research/:id — Cancel research
researchRouter.delete("/:id", async (c) => {
  const id = c.req.param("id");
  const parseResult = sessionIdSchema.safeParse(id);
  if (!parseResult.success) {
    return c.json({ error: "Invalid session ID" }, 400);
  }

  const session = await loadOwnedSession(c, id);
  if (!session) return notFound(c);

  if (session.status === "completed" || session.status === "cancelled") {
    return c.json({ error: "Session already terminated" }, 409);
  }

  // Update status
  await sessionService.updateSessionStatus(id, "cancelled");

  // Remove job from queue if still pending
  const queue = getResearchQueue();
  const job = await queue.getJob(id);
  if (job) {
    await job.remove();
  }

  return c.json({ success: true, sessionId: id });
});

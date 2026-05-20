import { Hono } from "hono";
import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import { generateId, createResearchSchema, userRespondSchema, sessionIdSchema, iterateResearchSchema } from "@contritas/shared";
import { getResearchQueue } from "../lib/queue.js";
import * as sessionService from "../services/session.service.js";
import * as streamService from "../services/stream.service.js";
import { authMiddleware } from "../middleware/auth.js";
import { rateLimit, clientIp } from "../middleware/rate-limit.js";

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
  await queue.add("research", { sessionId }, { jobId: sessionId });

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

  return streamSSE(c, async (stream) => {
    let aborted = false;
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    const sub = streamService.createSubscriber(id);

    stream.onAbort(() => {
      aborted = true;
      if (heartbeat) clearInterval(heartbeat);
      sub.unsubscribe();
    });

    // 1. Send catchup events
    const pastEvents = await streamService.getEventHistory(id);
    for (const event of pastEvents) {
      if (aborted) return;
      await stream.writeSSE({ data: event.data, id: event.id });
    }

    if (aborted) return;

    // 2. Subscribe to real-time events
    await sub.subscribe(async (data) => {
      if (aborted) return;
      await stream.writeSSE({ data, id: generateId() });
    });

    if (aborted) return;

    // 3. Heartbeat every 30s
    heartbeat = setInterval(async () => {
      try {
        await stream.writeSSE({ data: "", event: "heartbeat" });
      } catch {
        // Stream closed
        if (heartbeat) clearInterval(heartbeat);
      }
    }, 30_000);
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

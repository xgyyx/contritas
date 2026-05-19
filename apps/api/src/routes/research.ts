import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { generateId, createResearchSchema, userRespondSchema, sessionIdSchema, iterateResearchSchema } from "@contritas/shared";
import { getResearchQueue } from "../lib/queue.js";
import * as sessionService from "../services/session.service.js";
import * as streamService from "../services/stream.service.js";

export const researchRouter = new Hono();

// POST /api/research — Create a new research session
researchRouter.post("/", async (c) => {
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

  const session = await sessionService.getSessionWithCounts(id);
  if (!session) {
    return c.json({ error: "Session not found" }, 404);
  }

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

  const session = await sessionService.getSession(id);
  if (!session) {
    return c.json({ error: "Session not found" }, 404);
  }

  return streamSSE(c, async (stream) => {
    // 1. Send catchup events
    const pastEvents = await streamService.getEventHistory(id);
    for (const event of pastEvents) {
      await stream.writeSSE({ data: event.data, id: event.id });
    }

    // 2. Subscribe to real-time events
    const sub = streamService.createSubscriber(id);
    await sub.subscribe(async (data) => {
      await stream.writeSSE({ data, id: generateId() });
    });

    // 3. Heartbeat every 30s
    const heartbeat = setInterval(async () => {
      try {
        await stream.writeSSE({ data: "", event: "heartbeat" });
      } catch {
        // Stream closed
        clearInterval(heartbeat);
      }
    }, 30_000);

    stream.onAbort(() => {
      clearInterval(heartbeat);
      sub.unsubscribe();
    });
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

  const session = await sessionService.getSession(id);
  if (!session) {
    return c.json({ error: "Session not found" }, 404);
  }

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

  const session = await sessionService.getSession(id);
  if (!session) {
    return c.json({ error: "Session not found" }, 404);
  }

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

  const session = await sessionService.getSession(id);
  if (!session) {
    return c.json({ error: "Session not found" }, 404);
  }

  const evidence = await sessionService.getEvidence(id);
  return c.json({ evidence });
});

// POST /api/research/:id/iterate — Iterate on a completed research session
researchRouter.post("/:id/iterate", async (c) => {
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

  const session = await sessionService.getSession(id);
  if (!session) {
    return c.json({ error: "Session not found" }, 404);
  }

  if (session.status !== "completed") {
    return c.json({ error: "Session must be completed before iterating" }, 409);
  }

  const childSessionId = generateId();
  const queue = getResearchQueue();
  await queue.add("research-iterate", {
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

  const session = await sessionService.getSession(id);
  if (!session) {
    return c.json({ error: "Session not found" }, 404);
  }

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

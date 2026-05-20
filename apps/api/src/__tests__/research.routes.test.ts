import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock Redis with ioredis-mock so middleware (rate limiter, stream service)
// don't need a live Redis instance during integration tests.
vi.mock("../lib/redis.js", async () => {
  const RedisMock = (await import("ioredis-mock")).default;
  let shared: InstanceType<typeof RedisMock> | null = null;
  return {
    getRedis: () => {
      if (!shared) shared = new RedisMock();
      return shared;
    },
    createRedisConnection: () => new RedisMock(),
    closeRedis: async () => {
      if (shared) {
        await shared.quit();
        shared = null;
      }
    },
  };
});

// Mock Drizzle DB import — the routes only call session.service, which we mock
// fully below. The real drizzle import would try to connect to postgres.
vi.mock("../drizzle/index.js", () => ({
  db: {} as unknown,
  schema: {} as unknown,
  closeDb: async () => {},
}));

// Mock the BullMQ queue so enqueueing doesn't try to talk to Redis as a queue.
const queueAdd = vi.fn().mockResolvedValue({ id: "test-job" });
const queueGetJob = vi.fn().mockResolvedValue(null);
vi.mock("../lib/queue.js", () => ({
  getResearchQueue: () => ({
    add: queueAdd,
    getJob: queueGetJob,
  }),
}));

// In-memory session store so tests can manipulate state directly.
type Session = {
  id: string;
  status: "in_progress" | "awaiting_input" | "completed" | "failed" | "cancelled";
  input: { originalText: string; language: "zh" | "en" };
  config: { llmProvider: string; llmModel: string };
  ownerTokenHash?: string;
  parentSessionId?: string;
  createdAt: Date;
  completedAt?: Date;
  phases: unknown[];
  tokenUsage: { inputTokens: number; outputTokens: number; totalTokens: number; estimatedCostUSD: number };
  searchCallsUsed: number;
  complexity?: string;
};

const sessions = new Map<string, Session>();
const reports = new Map<string, { id: string; sessionId: string; version: number; markdownContent: string; overallScore: number; overallVerdict: string; charCount: number; sourceCount: number; generatedAt: Date }>();

vi.mock("../services/session.service.js", () => ({
  createSession: vi.fn(async (params: {
    id: string;
    input: Session["input"];
    config: Session["config"];
    ownerTokenHash?: string;
    parentSessionId?: string;
  }) => {
    const s: Session = {
      id: params.id,
      status: "in_progress",
      input: params.input,
      config: params.config,
      ownerTokenHash: params.ownerTokenHash,
      parentSessionId: params.parentSessionId,
      createdAt: new Date(),
      phases: [],
      tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCostUSD: 0 },
      searchCallsUsed: 0,
    };
    sessions.set(params.id, s);
    return s;
  }),
  getSession: vi.fn(async (id: string) => sessions.get(id) ?? null),
  getSessionWithCounts: vi.fn(async (id: string) => {
    const s = sessions.get(id);
    if (!s) return null;
    return {
      ...s,
      assumptionCount: 0,
      dimensionCount: 0,
      evidenceCount: 0,
    };
  }),
  updateSessionStatus: vi.fn(async (id: string, status: Session["status"]) => {
    const s = sessions.get(id);
    if (s) s.status = status;
  }),
  getReport: vi.fn(async (sessionId: string) => reports.get(sessionId) ?? null),
  getEvidence: vi.fn(async () => []),
}));

// Re-import after mocks so the app picks them up.
let app: typeof import("../index.js").default;

// Bootstrap once: importing index.ts triggers serve() which we DON'T want in
// tests, so we strip the side effects by re-exporting the Hono app via a thin
// wrapper that reuses the routes without binding to a port.
async function loadApp() {
  // Direct import of app: we avoid index.ts (which calls serve()) and instead
  // construct a minimal Hono app with the same middleware + router. This keeps
  // tests fast and free of port binding.
  const { Hono } = await import("hono");
  const { generateId } = await import("@contritas/shared");
  const { researchRouter } = await import("../routes/research.js");
  const a = new Hono();
  a.use("*", async (c, next) => {
    const incoming = c.req.header("X-Request-Id");
    const requestId = incoming && incoming.length <= 64 ? incoming : generateId();
    c.set("requestId", requestId);
    c.header("X-Request-Id", requestId);
    await next();
  });
  a.route("/api/research", researchRouter);
  a.notFound((c) => c.json({ error: "Not found" }, 404));
  a.onError((_err, c) => c.json({ error: "Internal", errorId: "test" }, 500));
  return a;
}

const TOKEN = "test-token";
const authHeaders = { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" };

beforeEach(() => {
  sessions.clear();
  reports.clear();
  queueAdd.mockClear();
  queueGetJob.mockClear();
});

describe("research routes", () => {
  beforeEach(async () => {
    app = (await loadApp()) as unknown as typeof app;
  });

  it("rejects unauthenticated requests", async () => {
    const res = await app.fetch(
      new Request("http://localhost/api/research/01HZTEST", {
        method: "GET",
      })
    );
    expect(res.status).toBe(401);
  });

  it("creates a session and enqueues a job", async () => {
    const res = await app.fetch(
      new Request("http://localhost/api/research", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          proposition: "Should our team migrate from REST to GraphQL given current scale?",
          language: "en",
        }),
      })
    );
    expect(res.status).toBe(202);
    const body = (await res.json()) as { sessionId: string; status: string };
    expect(body.sessionId).toBeDefined();
    expect(body.status).toBe("in_progress");
    expect(queueAdd).toHaveBeenCalledOnce();
    expect(queueAdd.mock.calls[0]?.[1]).toMatchObject({ sessionId: body.sessionId });
    // requestId is propagated to the job for log correlation
    expect(queueAdd.mock.calls[0]?.[1]?.requestId).toBeTypeOf("string");
  });

  it("rejects oversized proposition (input length cap)", async () => {
    const res = await app.fetch(
      new Request("http://localhost/api/research", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ proposition: "x".repeat(2001), language: "en" }),
      })
    );
    expect(res.status).toBe(400);
  });

  it("returns 404 for unknown session id", async () => {
    const res = await app.fetch(
      new Request("http://localhost/api/research/01J0000000000000000000000A", {
        method: "GET",
        headers: authHeaders,
      })
    );
    expect(res.status).toBe(404);
  });

  it("returns 400 for invalid session id format", async () => {
    const res = await app.fetch(
      new Request("http://localhost/api/research/not-a-ulid", {
        method: "GET",
        headers: authHeaders,
      })
    );
    expect(res.status).toBe(400);
  });

  it("enforces ownership: another token cannot read a session", async () => {
    // Create session as token A
    const create = await app.fetch(
      new Request("http://localhost/api/research", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ proposition: "A reasonable proposition for testing.", language: "en" }),
      })
    );
    const { sessionId } = (await create.json()) as { sessionId: string };

    // Read it as token B — must 404, not 403, to avoid existence enumeration
    process.env.API_AUTH_TOKEN = "test-token,other-token";
    // Reset auth module so the new token list is honored.
    vi.resetModules();
    const otherApp = (await loadApp()) as unknown as typeof app;
    const res = await otherApp.fetch(
      new Request(`http://localhost/api/research/${sessionId}`, {
        method: "GET",
        headers: { Authorization: `Bearer other-token` },
      })
    );
    expect(res.status).toBe(404);
    process.env.API_AUTH_TOKEN = "test-token";
  });

  it("returns session status with counts", async () => {
    const create = await app.fetch(
      new Request("http://localhost/api/research", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ proposition: "A reasonable proposition for testing.", language: "en" }),
      })
    );
    const { sessionId } = (await create.json()) as { sessionId: string };
    const res = await app.fetch(
      new Request(`http://localhost/api/research/${sessionId}`, {
        method: "GET",
        headers: authHeaders,
      })
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; status: string; assumptionCount: number };
    expect(body.id).toBe(sessionId);
    expect(body.assumptionCount).toBe(0);
  });

  it("returns 404 for evidence on unknown session", async () => {
    const res = await app.fetch(
      new Request("http://localhost/api/research/01J0000000000000000000000A/evidence", {
        method: "GET",
        headers: authHeaders,
      })
    );
    expect(res.status).toBe(404);
  });

  it("returns 404 for report when not yet generated", async () => {
    const create = await app.fetch(
      new Request("http://localhost/api/research", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ proposition: "A reasonable proposition for testing.", language: "en" }),
      })
    );
    const { sessionId } = (await create.json()) as { sessionId: string };
    const res = await app.fetch(
      new Request(`http://localhost/api/research/${sessionId}/report`, {
        method: "GET",
        headers: authHeaders,
      })
    );
    expect(res.status).toBe(404);
  });

  it("rejects /respond when session is not awaiting_input", async () => {
    const create = await app.fetch(
      new Request("http://localhost/api/research", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ proposition: "A reasonable proposition for testing.", language: "en" }),
      })
    );
    const { sessionId } = (await create.json()) as { sessionId: string };
    const res = await app.fetch(
      new Request(`http://localhost/api/research/${sessionId}/respond`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ response: "ok" }),
      })
    );
    expect(res.status).toBe(409);
  });

  it("rejects /iterate before session is completed", async () => {
    const create = await app.fetch(
      new Request("http://localhost/api/research", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ proposition: "A reasonable proposition for testing.", language: "en" }),
      })
    );
    const { sessionId } = (await create.json()) as { sessionId: string };
    const res = await app.fetch(
      new Request(`http://localhost/api/research/${sessionId}/iterate`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ type: "deep_dive", target: "dim-1" }),
      })
    );
    expect(res.status).toBe(409);
  });

  it("cancels an in-progress session", async () => {
    const create = await app.fetch(
      new Request("http://localhost/api/research", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ proposition: "A reasonable proposition for testing.", language: "en" }),
      })
    );
    const { sessionId } = (await create.json()) as { sessionId: string };
    const res = await app.fetch(
      new Request(`http://localhost/api/research/${sessionId}`, {
        method: "DELETE",
        headers: authHeaders,
      })
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean };
    expect(body.success).toBe(true);
  });

  it("emits X-Request-Id header on responses", async () => {
    const res = await app.fetch(
      new Request("http://localhost/api/research/01J0000000000000000000000A", {
        method: "GET",
        headers: authHeaders,
      })
    );
    expect(res.headers.get("X-Request-Id")).toBeTruthy();
  });
});

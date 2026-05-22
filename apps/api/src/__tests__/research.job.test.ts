import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock Redis with ioredis-mock so the clarification handler can subscribe
// and we can publish in the test without a live Redis. ioredis-mock supports
// pub/sub between instances that share a config object.
vi.mock("../lib/redis.js", async () => {
  const RedisMock = (await import("ioredis-mock")).default;
  return {
    getRedis: () => new RedisMock(),
    createRedisConnection: () => new RedisMock(),
    closeRedis: async () => {},
  };
});

// Mock session service (avoids drizzle/postgres). vi.mock factories run before
// top-level locals are initialized, so hoist the spy via vi.hoisted.
const { updateSessionStatus } = vi.hoisted(() => ({
  updateSessionStatus: vi.fn(async () => undefined),
}));
vi.mock("../services/session.service.js", () => ({
  updateSessionStatus,
}));

// Stub out workflow.service so we don't pull the whole pipeline into this test.
vi.mock("../services/workflow.service.js", () => ({
  createWorkflowController: vi.fn(),
  createWorkflowControllerFromContext: vi.fn(),
  createIterateContext: vi.fn(),
  buildSearchDeps: vi.fn(),
}));

import { handleAwaitingClarification } from "../jobs/research.job.js";
import { createLogger } from "../lib/logger.js";
import { default as RedisMock } from "ioredis-mock";

type Controller = {
  cancel: ReturnType<typeof vi.fn>;
  sendUserResponse: ReturnType<typeof vi.fn>;
};

function makeController(): Controller {
  return {
    cancel: vi.fn(),
    sendUserResponse: vi.fn(),
  };
}

function makeJob(overrides: Partial<{ token: string; extendLock: ReturnType<typeof vi.fn> }> = {}) {
  return {
    token: overrides.token ?? "lock-token-123",
    extendLock: overrides.extendLock ?? vi.fn().mockResolvedValue(undefined),
  };
}

describe("BullMQ clarification handler (6.3.1–6.3.3 regression)", () => {
  beforeEach(() => {
    updateSessionStatus.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("6.3.2: throws when job.token is missing — does not call extendLock with empty string", async () => {
    const ctrl = makeController();
    const job = makeJob({ token: "" });

    await expect(
      handleAwaitingClarification(
        "session-1",
        ctrl as any,
        job as any,
        createLogger("test")
      )
    ).rejects.toThrow(/Missing job token/);
    expect(job.extendLock).not.toHaveBeenCalled();
    expect(ctrl.sendUserResponse).not.toHaveBeenCalled();
  });

  it("6.3.1 happy path: first published response settles the wait, only-once dispatch", async () => {
    const ctrl = makeController();
    const job = makeJob();

    // The handler subscribes to `research:<sessionId>:response` via
    // createRedisConnection() — that returns a fresh ioredis-mock. Pub/Sub
    // is shared across mock instances, so we publish from a separate mock.
    const publisher = new RedisMock();

    const handlerPromise = handleAwaitingClarification(
      "sess-A",
      ctrl as any,
      job as any,
      createLogger("test")
    );

    // Wait one microtask + macrotask for the subscriber to subscribe.
    await new Promise((r) => setTimeout(r, 20));

    // Publish two messages — only the first should be consumed.
    await publisher.publish("research:sess-A:response", "first answer");
    await publisher.publish("research:sess-A:response", "second answer");

    await handlerPromise;

    expect(ctrl.sendUserResponse).toHaveBeenCalledTimes(1);
    expect(ctrl.sendUserResponse).toHaveBeenCalledWith("first answer");
    expect(ctrl.cancel).not.toHaveBeenCalled();
    // Status flips to awaiting_input on entry, in_progress on response.
    expect(updateSessionStatus).toHaveBeenCalledWith("sess-A", "awaiting_input");
    expect(updateSessionStatus).toHaveBeenCalledWith("sess-A", "in_progress");
  });

  it("6.3.2: extendLock is called with the real token (not empty string)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const ctrl = makeController();
    const extendLock = vi.fn().mockResolvedValue(undefined);
    const job = makeJob({ token: "real-token-xyz", extendLock });

    const publisher = new RedisMock();
    const handlerPromise = handleAwaitingClarification(
      "sess-B",
      ctrl as any,
      job as any,
      createLogger("test")
    );

    // Advance past the 15s lock-extend interval so extendLock fires at least once.
    await vi.advanceTimersByTimeAsync(16_000);

    expect(extendLock).toHaveBeenCalled();
    expect(extendLock.mock.calls[0][0]).toBe("real-token-xyz");
    expect(extendLock.mock.calls[0][1]).toBe(60_000);

    // Settle the wait so the handler exits and clears its interval.
    await publisher.publish("research:sess-B:response", "ack");
    await vi.runOnlyPendingTimersAsync();
    await handlerPromise;
  });

  it("6.3.1 timeout path: cancels controller and throws after 30 minutes", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const ctrl = makeController();
    const job = makeJob();

    // Attach the rejection handler synchronously to avoid Node's
    // unhandledrejection firing before expect() can attach later.
    const handlerPromise = handleAwaitingClarification(
      "sess-C",
      ctrl as any,
      job as any,
      createLogger("test")
    );
    const tracked = handlerPromise.catch((e) => e as Error);

    // Drive the 30-minute timer to completion.
    await vi.advanceTimersByTimeAsync(30 * 60 * 1000 + 100);

    const err = await tracked;
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/Clarification timeout/);
    expect(ctrl.cancel).toHaveBeenCalledTimes(1);
    expect(ctrl.sendUserResponse).not.toHaveBeenCalled();
  });

  it("6.3.2: extendLock failure surfaces (does not silently swallow)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const ctrl = makeController();
    const extendLock = vi
      .fn()
      .mockRejectedValueOnce(new Error("lock token mismatch"));
    const job = makeJob({ extendLock });

    const handlerPromise = handleAwaitingClarification(
      "sess-D",
      ctrl as any,
      job as any,
      createLogger("test")
    );
    const tracked = handlerPromise.catch((e) => e as Error);

    // Trigger the first extendLock tick; it rejects, which should reject the
    // outer promise rather than be swallowed.
    await vi.advanceTimersByTimeAsync(16_000);

    const err = await tracked;
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/lock token mismatch/);
    expect(ctrl.sendUserResponse).not.toHaveBeenCalled();
  });
});

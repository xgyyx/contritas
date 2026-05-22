import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/constants", () => ({
  API_URL: "http://api.test",
  API_TOKEN: "tkn",
}));

import { createSSEClient } from "@/lib/sse-client";

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  url: string;
  onopen: ((this: EventSource, ev: Event) => any) | null = null;
  onerror: ((this: EventSource, ev: Event) => any) | null = null;
  onmessage: ((this: EventSource, ev: MessageEvent) => any) | null = null;
  closed = false;

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }

  close() {
    this.closed = true;
  }

  // Helpers for tests
  emitOpen() {
    this.onopen?.call(this as unknown as EventSource, new Event("open"));
  }
  emitError() {
    this.onerror?.call(this as unknown as EventSource, new Event("error"));
  }
  emitMessage(data: string, lastEventId = "") {
    this.onmessage?.call(
      this as unknown as EventSource,
      { data, lastEventId } as MessageEvent
    );
  }
}

describe("createSSEClient (6.7.3 reconnect backoff)", () => {
  let originalES: typeof globalThis.EventSource | undefined;

  beforeEach(() => {
    FakeEventSource.instances = [];
    originalES = globalThis.EventSource;
    (globalThis as any).EventSource = FakeEventSource;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    if (originalES === undefined) delete (globalThis as any).EventSource;
    else (globalThis as any).EventSource = originalES;
  });

  it("connects and includes the token query string in the URL", () => {
    const onOpen = vi.fn();
    const onEvent = vi.fn();
    const onError = vi.fn();
    const client = createSSEClient("sess-1", { onEvent, onOpen, onError });
    client.connect();

    expect(FakeEventSource.instances).toHaveLength(1);
    expect(FakeEventSource.instances[0].url).toBe(
      "http://api.test/api/research/sess-1/stream?token=tkn"
    );

    FakeEventSource.instances[0].emitOpen();
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("parses message data and forwards to onEvent; ignores parse errors", () => {
    const onEvent = vi.fn();
    const client = createSSEClient("s", {
      onEvent,
      onOpen: vi.fn(),
      onError: vi.fn(),
    });
    client.connect();

    const es = FakeEventSource.instances[0];
    es.emitMessage(JSON.stringify({ type: "phase_change", phase: "x" }));
    es.emitMessage("not-json"); // should be silently ignored

    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(onEvent.mock.calls[0][0]).toMatchObject({ type: "phase_change" });
  });

  it("reconnects with exponential backoff (1s, 2s, 4s, ...) on errors", async () => {
    const onError = vi.fn();
    const client = createSSEClient("s", {
      onEvent: vi.fn(),
      onOpen: vi.fn(),
      onError,
    });
    client.connect();
    expect(FakeEventSource.instances).toHaveLength(1);

    // First failure → schedule reconnect after 1000ms.
    FakeEventSource.instances[0].emitError();
    expect(FakeEventSource.instances[0].closed).toBe(true);
    expect(onError).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1000);
    expect(FakeEventSource.instances).toHaveLength(2);

    // Second failure → 2000ms.
    FakeEventSource.instances[1].emitError();
    await vi.advanceTimersByTimeAsync(1999);
    expect(FakeEventSource.instances).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(2);
    expect(FakeEventSource.instances).toHaveLength(3);

    // Third failure → 4000ms.
    FakeEventSource.instances[2].emitError();
    await vi.advanceTimersByTimeAsync(3999);
    expect(FakeEventSource.instances).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(2);
    expect(FakeEventSource.instances).toHaveLength(4);
  });

  it("disconnect() prevents any further reconnect attempts", async () => {
    const client = createSSEClient("s", {
      onEvent: vi.fn(),
      onOpen: vi.fn(),
      onError: vi.fn(),
    });
    client.connect();
    expect(FakeEventSource.instances).toHaveLength(1);

    // Simulate error then user-initiated disconnect during the backoff window.
    FakeEventSource.instances[0].emitError();
    client.disconnect();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(FakeEventSource.instances).toHaveLength(1);
  });

  // ──────────────────────────────────────────────────────────────────────
  // 6.4.8 (R2): server supports `?lastEventId=` incremental replay, but
  // native EventSource only auto-sends the Last-Event-ID *header* on its
  // own reconnect; when we close + reopen on error the next connection
  // forgets it. Track lastEventId manually and pin it on the URL.
  // ──────────────────────────────────────────────────────────────────────

  it("forwards the latest lastEventId to the reconnect URL (6.4.8 R2)", async () => {
    const client = createSSEClient("s", {
      onEvent: vi.fn(),
      onOpen: vi.fn(),
      onError: vi.fn(),
    });
    client.connect();

    const first = FakeEventSource.instances[0];
    expect(first.url).toBe("http://api.test/api/research/s/stream?token=tkn");

    // Server pushes 3 events with monotonically growing ids; the last one
    // is what we want pinned on the next reconnect URL.
    first.emitMessage(JSON.stringify({ type: "phase_change" }), "1700000000000-0");
    first.emitMessage(JSON.stringify({ type: "phase_change" }), "1700000000001-0");
    first.emitMessage(JSON.stringify({ type: "phase_change" }), "1700000000002-0");

    first.emitError();
    await vi.advanceTimersByTimeAsync(1000);

    const second = FakeEventSource.instances[1];
    // Both token and lastEventId are present; URLSearchParams encodes the
    // hyphen literally so we can string-match.
    expect(second.url).toContain("token=tkn");
    expect(second.url).toContain("lastEventId=1700000000002-0");
  });

  it("captures lastEventId even on heartbeats with empty data (6.4.8 R2)", async () => {
    const onEvent = vi.fn();
    const client = createSSEClient("s", {
      onEvent,
      onOpen: vi.fn(),
      onError: vi.fn(),
    });
    client.connect();

    const first = FakeEventSource.instances[0];
    // Heartbeat: id present, data empty — onEvent must NOT fire, but
    // lastEventId should still advance so we don't replay the heartbeat
    // window again on reconnect.
    first.emitMessage("", "1700000000050-0");
    expect(onEvent).not.toHaveBeenCalled();

    first.emitError();
    await vi.advanceTimersByTimeAsync(1000);
    expect(FakeEventSource.instances[1].url).toContain("lastEventId=1700000000050-0");
  });

  it("does not include lastEventId on the very first connect (6.4.8 R2)", () => {
    const client = createSSEClient("s", {
      onEvent: vi.fn(),
      onOpen: vi.fn(),
      onError: vi.fn(),
    });
    client.connect();

    expect(FakeEventSource.instances[0].url).not.toContain("lastEventId=");
  });

  it("a successful onopen resets the reconnect attempts so next failure goes back to 1s", async () => {
    const client = createSSEClient("s", {
      onEvent: vi.fn(),
      onOpen: vi.fn(),
      onError: vi.fn(),
    });
    client.connect();

    // Crash twice, then succeed, then crash once more — last failure should
    // wait only 1000ms again (not 4000ms) because attempts reset on open.
    FakeEventSource.instances[0].emitError();
    await vi.advanceTimersByTimeAsync(1000);
    FakeEventSource.instances[1].emitError();
    await vi.advanceTimersByTimeAsync(2000);
    FakeEventSource.instances[2].emitOpen();

    FakeEventSource.instances[2].emitError();
    await vi.advanceTimersByTimeAsync(999);
    expect(FakeEventSource.instances).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(2);
    expect(FakeEventSource.instances).toHaveLength(4);
  });
});

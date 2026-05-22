import type { ProgressEvent } from "@/types";
import { API_URL, API_TOKEN } from "./constants";

const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30000;

export interface SSEClientOptions {
  onEvent: (event: ProgressEvent) => void;
  onOpen: () => void;
  onError: () => void;
}

export interface SSEClient {
  connect: () => void;
  disconnect: () => void;
}

export function createSSEClient(sessionId: string, options: SSEClientOptions): SSEClient {
  let eventSource: EventSource | null = null;
  let reconnectAttempts = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let intentionalClose = false;
  // 6.4.8 (R2): the API supports incremental replay via `?lastEventId=` (and
  // `Last-Event-ID` header), but native EventSource only auto-sends the
  // header when reconnecting *itself* — once we close + reopen on error,
  // the new connection forgets it. Track the latest id manually and pin it
  // on the URL so the server xrange's from there instead of "-".
  let lastEventId: string | null = null;

  function buildUrl(): string {
    const params = new URLSearchParams();
    if (API_TOKEN) params.set("token", API_TOKEN);
    if (lastEventId) params.set("lastEventId", lastEventId);
    const qs = params.toString();
    return `${API_URL}/api/research/${sessionId}/stream${qs ? `?${qs}` : ""}`;
  }

  function connect() {
    intentionalClose = false;
    eventSource = new EventSource(buildUrl());

    eventSource.onopen = () => {
      reconnectAttempts = 0;
      options.onOpen();
    };

    eventSource.onmessage = (msgEvent) => {
      // Capture id even when data is empty (heartbeats, retry directives) —
      // skipping it would let lastEventId stagnate behind the live stream.
      if (msgEvent.lastEventId) lastEventId = msgEvent.lastEventId;
      if (!msgEvent.data) return;
      try {
        const event: ProgressEvent = JSON.parse(msgEvent.data);
        options.onEvent(event);
      } catch {
        // Ignore parse errors (heartbeats, malformed)
      }
    };

    eventSource.onerror = () => {
      eventSource?.close();
      options.onError();

      if (!intentionalClose) {
        scheduleReconnect();
      }
    };
  }

  function scheduleReconnect() {
    const delay = Math.min(
      RECONNECT_BASE_MS * Math.pow(2, reconnectAttempts),
      RECONNECT_MAX_MS
    );
    reconnectAttempts++;
    reconnectTimer = setTimeout(connect, delay);
  }

  function disconnect() {
    intentionalClose = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    eventSource?.close();
    eventSource = null;
  }

  return { connect, disconnect };
}

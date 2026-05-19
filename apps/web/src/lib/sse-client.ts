import type { ProgressEvent } from "@/types";
import { API_URL } from "./constants";

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

  function connect() {
    intentionalClose = false;
    const url = `${API_URL}/api/research/${sessionId}/stream`;
    eventSource = new EventSource(url);

    eventSource.onopen = () => {
      reconnectAttempts = 0;
      options.onOpen();
    };

    eventSource.onmessage = (msgEvent) => {
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

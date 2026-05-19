"use client";

import { useEffect, useRef, useCallback } from "react";
import { useResearchStore } from "@/stores/research-store";
import { createSSEClient, type SSEClient } from "@/lib/sse-client";

interface UseResearchStreamOptions {
  sessionId: string | null;
  enabled?: boolean;
}

export function useResearchStream({ sessionId, enabled = true }: UseResearchStreamOptions) {
  const clientRef = useRef<SSEClient | null>(null);
  const handleEvent = useResearchStore((s) => s.handleEvent);
  const setConnected = useResearchStore((s) => s.setConnected);
  const incrementReconnect = useResearchStore((s) => s.incrementReconnect);

  useEffect(() => {
    if (!sessionId || !enabled) return;

    const client = createSSEClient(sessionId, {
      onEvent: (event) => {
        handleEvent(event);
      },
      onOpen: () => setConnected(true),
      onError: () => {
        setConnected(false);
        incrementReconnect();
      },
    });

    client.connect();
    clientRef.current = client;

    return () => {
      client.disconnect();
      clientRef.current = null;
      setConnected(false);
    };
  }, [sessionId, enabled, handleEvent, setConnected, incrementReconnect]);

  const disconnect = useCallback(() => {
    clientRef.current?.disconnect();
  }, []);

  return { disconnect };
}

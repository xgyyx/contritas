"use client";

import { useEffect, useRef } from "react";
import { useResearchStore } from "@/stores/research-store";
import { api } from "@/lib/api-client";

interface UseResearchSessionOptions {
  sessionId: string | null;
  pollInterval?: number;
  enabled?: boolean;
}

export function useResearchSession({
  sessionId,
  pollInterval = 10000,
  enabled = true,
}: UseResearchSessionOptions) {
  const setStatus = useResearchStore((s) => s.setStatus);
  const setPhases = useResearchStore((s) => s.setPhases);
  const setTokenUsage = useResearchStore((s) => s.setTokenUsage);
  const setSearchCallsUsed = useResearchStore((s) => s.setSearchCallsUsed);
  const setComplexity = useResearchStore((s) => s.setComplexity);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!sessionId || !enabled) return;

    async function fetchSession() {
      try {
        const data = await api.getSession(sessionId!);
        setStatus(data.status);
        setPhases(data.phases);
        setTokenUsage(data.tokenUsage);
        setSearchCallsUsed(data.searchCallsUsed);
        if (data.complexity) setComplexity(data.complexity);
      } catch {
        // Silently fail, SSE is primary
      }
    }

    fetchSession();
    timerRef.current = setInterval(fetchSession, pollInterval);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [sessionId, pollInterval, enabled, setStatus, setPhases, setTokenUsage, setSearchCallsUsed, setComplexity]);
}

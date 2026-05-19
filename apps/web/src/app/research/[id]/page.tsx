"use client";

import { useEffect } from "react";
import { useParams } from "next/navigation";
import { useResearchStore } from "@/stores/research-store";
import { useResearchStream } from "@/hooks/use-research-stream";
import { useResearchSession } from "@/hooks/use-research-session";
import { ProgressPanel } from "@/components/research/progress-panel";
import { ReportViewer } from "@/components/report/report-viewer";
import { api } from "@/lib/api-client";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import Link from "next/link";
import { XCircle, ArrowLeft } from "lucide-react";

export default function ResearchPage() {
  const params = useParams();
  const sessionId = params.id as string;

  const status = useResearchStore((s) => s.status);
  const setSessionId = useResearchStore((s) => s.setSessionId);
  const setStatus = useResearchStore((s) => s.setStatus);
  const setPhases = useResearchStore((s) => s.setPhases);
  const setTokenUsage = useResearchStore((s) => s.setTokenUsage);
  const setSearchCallsUsed = useResearchStore((s) => s.setSearchCallsUsed);
  const setComplexity = useResearchStore((s) => s.setComplexity);
  const setReport = useResearchStore((s) => s.setReport);
  const reset = useResearchStore((s) => s.reset);

  // Connect SSE when in_progress or awaiting_input
  const isActive = status === "in_progress" || status === "awaiting_input" || status === null;
  useResearchStream({ sessionId, enabled: isActive });
  useResearchSession({ sessionId, enabled: isActive, pollInterval: 15000 });

  // Initial fetch
  useEffect(() => {
    reset();
    setSessionId(sessionId);

    async function loadInitial() {
      try {
        const session = await api.getSession(sessionId);
        setStatus(session.status);
        setPhases(session.phases);
        setTokenUsage(session.tokenUsage);
        setSearchCallsUsed(session.searchCallsUsed);
        if (session.complexity) setComplexity(session.complexity);

        if (session.status === "completed") {
          const reportData = await api.getReport(sessionId);
          setReport(reportData as any);
        }
      } catch {
        setStatus("failed");
      }
    }

    loadInitial();
  }, [sessionId, reset, setSessionId, setStatus, setPhases, setTokenUsage, setSearchCallsUsed, setComplexity, setReport]);

  // Fetch report when status transitions to completed
  useEffect(() => {
    if (status === "completed") {
      api.getReport(sessionId).then((data) => setReport(data as any)).catch(() => {});
    }
  }, [status, sessionId, setReport]);

  // Loading state
  if (status === null) {
    return (
      <div className="container py-8 max-w-4xl space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  // Failed / Cancelled
  if (status === "failed" || status === "cancelled") {
    return (
      <div className="container py-8 max-w-2xl">
        <Alert variant="destructive">
          <XCircle className="h-4 w-4" />
          <AlertTitle>{status === "failed" ? "研究失败" : "研究已取消"}</AlertTitle>
          <AlertDescription>
            {status === "failed"
              ? "研究过程中出现了不可恢复的错误。"
              : "此研究已被手动取消。"}
          </AlertDescription>
        </Alert>
        <div className="mt-4">
          <Link href="/">
            <Button variant="outline">
              <ArrowLeft className="h-4 w-4 mr-2" />
              开始新研究
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  // Completed — show report
  if (status === "completed") {
    return <ReportViewer sessionId={sessionId} />;
  }

  // In progress or awaiting input
  return (
    <div className="container py-8 max-w-4xl">
      <ProgressPanel sessionId={sessionId} />
    </div>
  );
}

"use client";

import { useResearchStore } from "@/stores/research-store";
import { PhaseTimeline } from "./phase-timeline";
import { DimensionProgress } from "./dimension-progress";
import { SearchLog } from "./search-log";
import { EvidenceFeed } from "./evidence-feed";
import { EtaDisplay } from "./eta-display";
import { SessionStats } from "./session-stats";
import { ErrorBanner } from "./error-banner";
import { ClarificationDialog } from "./clarification-dialog";
import { CancelButton } from "./cancel-button";
import { Progress } from "@/components/ui/progress";
import { selectProgressPercent } from "@/stores/research-store";
import { Badge } from "@/components/ui/badge";
import { Wifi, WifiOff } from "lucide-react";

interface ProgressPanelProps {
  sessionId: string;
}

export function ProgressPanel({ sessionId }: ProgressPanelProps) {
  const phases = useResearchStore((s) => s.phases);
  const dimensions = useResearchStore((s) => s.dimensions);
  const searchLog = useResearchStore((s) => s.searchLog);
  const evidenceFeed = useResearchStore((s) => s.evidenceFeed);
  const estimatedSecondsRemaining = useResearchStore((s) => s.estimatedSecondsRemaining);
  const tokenUsage = useResearchStore((s) => s.tokenUsage);
  const searchCallsUsed = useResearchStore((s) => s.searchCallsUsed);
  const complexity = useResearchStore((s) => s.complexity);
  const errors = useResearchStore((s) => s.errors);
  const clarificationQuestions = useResearchStore((s) => s.clarificationQuestions);
  const suggestedDirections = useResearchStore((s) => s.suggestedDirections);
  const isConnected = useResearchStore((s) => s.isConnected);
  const progressPercent = useResearchStore(selectProgressPercent);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold">研究进行中</h2>
          <Badge variant="outline" className="gap-1 text-xs">
            {isConnected ? (
              <>
                <Wifi className="h-3 w-3 text-green-600" />
                已连接
              </>
            ) : (
              <>
                <WifiOff className="h-3 w-3 text-red-600" />
                重连中
              </>
            )}
          </Badge>
        </div>
        <CancelButton sessionId={sessionId} />
      </div>

      {/* Overall progress */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">总进度</span>
          <span className="text-sm font-medium">{progressPercent}%</span>
        </div>
        <Progress value={progressPercent} className="h-2" />
      </div>

      {/* Stats + ETA */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <SessionStats tokenUsage={tokenUsage} searchCallsUsed={searchCallsUsed} complexity={complexity} />
        <EtaDisplay estimatedSecondsRemaining={estimatedSecondsRemaining} />
      </div>

      {/* Errors */}
      <ErrorBanner errors={errors} />

      {/* Phase timeline + dimensions */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <PhaseTimeline phases={phases} />
        <DimensionProgress dimensions={dimensions} />
      </div>

      {/* Logs */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <SearchLog entries={searchLog} />
        <EvidenceFeed entries={evidenceFeed} />
      </div>

      {/* Clarification */}
      <ClarificationDialog
        sessionId={sessionId}
        questions={clarificationQuestions}
        suggestedDirections={suggestedDirections}
      />
    </div>
  );
}

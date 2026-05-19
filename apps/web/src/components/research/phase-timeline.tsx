"use client";

import { cn } from "@/lib/cn";
import { PHASE_LABELS, PHASE_ORDER } from "@/lib/constants";
import type { PhaseState } from "@/types";
import { CheckCircle2, Circle, Loader2, XCircle } from "lucide-react";

interface PhaseTimelineProps {
  phases: PhaseState[];
}

const statusIcon = {
  pending: <Circle className="h-5 w-5 text-muted-foreground" />,
  started: <Loader2 className="h-5 w-5 text-blue-600 animate-spin" />,
  completed: <CheckCircle2 className="h-5 w-5 text-green-600" />,
  failed: <XCircle className="h-5 w-5 text-red-600" />,
};

export function PhaseTimeline({ phases }: PhaseTimelineProps) {
  const phaseMap = new Map(phases.map((p) => [p.id, p]));

  return (
    <div className="space-y-1">
      <h3 className="text-sm font-medium mb-3">研究阶段</h3>
      <div className="space-y-0">
        {PHASE_ORDER.map((phaseId, idx) => {
          const phase = phaseMap.get(phaseId);
          const status = phase?.status ?? "pending";
          const isLast = idx === PHASE_ORDER.length - 1;

          return (
            <div key={phaseId} className="flex items-start gap-3">
              <div className="flex flex-col items-center">
                {statusIcon[status]}
                {!isLast && (
                  <div
                    className={cn(
                      "w-px h-6 mt-1",
                      status === "completed" ? "bg-green-300" : "bg-border"
                    )}
                  />
                )}
              </div>
              <div className="pb-6">
                <p
                  className={cn(
                    "text-sm font-medium leading-5",
                    status === "started" && "text-blue-700",
                    status === "completed" && "text-green-700",
                    status === "failed" && "text-red-700",
                    status === "pending" && "text-muted-foreground"
                  )}
                >
                  {PHASE_LABELS[phaseId]}
                </p>
                {phase?.error && (
                  <p className="text-xs text-red-600 mt-0.5">{phase.error}</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

"use client";

import { Clock } from "lucide-react";

interface EtaDisplayProps {
  estimatedSecondsRemaining: number | null;
}

function formatTime(seconds: number): string {
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (minutes < 60) return `${minutes} 分 ${secs > 0 ? `${secs} 秒` : ""}`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours} 小时 ${mins} 分`;
}

export function EtaDisplay({ estimatedSecondsRemaining }: EtaDisplayProps) {
  if (estimatedSecondsRemaining === null) return null;

  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <Clock className="h-4 w-4" />
      <span>预计剩余 {formatTime(estimatedSecondsRemaining)}</span>
    </div>
  );
}

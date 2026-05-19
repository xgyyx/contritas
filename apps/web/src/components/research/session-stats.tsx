"use client";

import { Badge } from "@/components/ui/badge";
import type { TokenUsage, ComplexityLevel } from "@/types";
import { Activity, Search, Zap } from "lucide-react";

interface SessionStatsProps {
  tokenUsage: TokenUsage | null;
  searchCallsUsed: number;
  complexity: ComplexityLevel | null;
}

const complexityLabels: Record<string, string> = {
  low: "低复杂度",
  medium: "中复杂度",
  high: "高复杂度",
};

export function SessionStats({ tokenUsage, searchCallsUsed, complexity }: SessionStatsProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {complexity && (
        <Badge variant="outline" className="gap-1">
          <Zap className="h-3 w-3" />
          {complexityLabels[complexity] ?? complexity}
        </Badge>
      )}
      <Badge variant="outline" className="gap-1">
        <Search className="h-3 w-3" />
        {searchCallsUsed}/150 搜索
      </Badge>
      {tokenUsage && (
        <Badge variant="outline" className="gap-1">
          <Activity className="h-3 w-3" />
          {(tokenUsage.totalTokens / 1000).toFixed(0)}K tokens
        </Badge>
      )}
      {tokenUsage && tokenUsage.estimatedCostUSD > 0 && (
        <Badge variant="outline" className="text-xs">
          ${tokenUsage.estimatedCostUSD.toFixed(3)}
        </Badge>
      )}
    </div>
  );
}

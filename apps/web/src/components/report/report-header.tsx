"use client";

import { Badge } from "@/components/ui/badge";
import { VERDICT_LABELS, VERDICT_COLORS } from "@/lib/constants";
import type { OverallVerdict } from "@/types";
import { cn } from "@/lib/cn";
import { Calendar, FileText, BookOpen } from "lucide-react";

interface ReportHeaderProps {
  overallScore?: string;
  overallVerdict?: OverallVerdict;
  charCount?: number;
  sourceCount?: number;
  generatedAt: string;
}

export function ReportHeader({
  overallScore,
  overallVerdict,
  charCount,
  sourceCount,
  generatedAt,
}: ReportHeaderProps) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 flex-wrap">
        {overallScore && (
          <div className="flex items-baseline gap-1">
            <span className="text-3xl font-bold">{overallScore}</span>
            <span className="text-sm text-muted-foreground">/10</span>
          </div>
        )}
        {overallVerdict && (
          <Badge className={cn("text-sm px-3 py-1", VERDICT_COLORS[overallVerdict])}>
            {VERDICT_LABELS[overallVerdict]}
          </Badge>
        )}
      </div>

      <div className="flex items-center gap-4 text-sm text-muted-foreground">
        <span className="flex items-center gap-1">
          <Calendar className="h-3.5 w-3.5" />
          {new Date(generatedAt).toLocaleString("zh-CN")}
        </span>
        {charCount && (
          <span className="flex items-center gap-1">
            <FileText className="h-3.5 w-3.5" />
            {charCount.toLocaleString()} 字
          </span>
        )}
        {sourceCount && (
          <span className="flex items-center gap-1">
            <BookOpen className="h-3.5 w-3.5" />
            {sourceCount} 条来源
          </span>
        )}
      </div>
    </div>
  );
}

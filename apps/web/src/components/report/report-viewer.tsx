"use client";

import { useMemo } from "react";
import { useResearchStore } from "@/stores/research-store";
import { ReportHeader } from "./report-header";
import { ReportToc } from "./report-toc";
import { ReportContent } from "./report-content";
import { IteratePanel } from "./iterate-panel";
import { extractHeadings } from "./markdown-renderer";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import type { OverallVerdict } from "@/types";

interface ReportViewerProps {
  sessionId: string;
}

export function ReportViewer({ sessionId }: ReportViewerProps) {
  const report = useResearchStore((s) => s.report);

  const headings = useMemo(() => {
    if (!report?.markdownContent) return [];
    return extractHeadings(report.markdownContent);
  }, [report?.markdownContent]);

  if (!report) {
    return (
      <div className="container py-8 max-w-5xl space-y-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-6 w-96" />
        <Skeleton className="h-[600px] w-full" />
      </div>
    );
  }

  return (
    <div className="container py-8 max-w-6xl">
      {/* Header */}
      <ReportHeader
        overallScore={report.overallScore}
        overallVerdict={report.overallVerdict as OverallVerdict | undefined}
        charCount={report.charCount}
        sourceCount={report.sourceCount}
        generatedAt={report.generatedAt}
      />

      <Separator className="my-6" />

      {/* Main content: TOC + Report */}
      <div className="flex gap-8">
        {/* TOC sidebar (desktop only) */}
        <aside className="hidden lg:block w-56 shrink-0 sticky top-20 self-start">
          <ReportToc headings={headings} />
        </aside>

        {/* Report content */}
        <div className="flex-1 min-w-0">
          <ReportContent markdownContent={report.markdownContent} />

          <Separator className="my-8" />

          {/* Iterate panel */}
          <IteratePanel sessionId={sessionId} />
        </div>
      </div>
    </div>
  );
}

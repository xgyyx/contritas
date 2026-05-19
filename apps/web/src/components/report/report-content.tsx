"use client";

import { MarkdownRenderer } from "./markdown-renderer";

interface ReportContentProps {
  markdownContent: string;
}

export function ReportContent({ markdownContent }: ReportContentProps) {
  return (
    <div className="py-4">
      <MarkdownRenderer content={markdownContent} />
    </div>
  );
}

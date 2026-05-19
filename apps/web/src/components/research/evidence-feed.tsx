"use client";

import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { CREDIBILITY_COLORS, CREDIBILITY_LABELS } from "@/lib/constants";
import { cn } from "@/lib/cn";
import { FileText } from "lucide-react";

interface EvidenceFeedEntry {
  dimensionId: string;
  source: string;
  credibility: "high" | "medium" | "low";
  timestamp: string;
}

interface EvidenceFeedProps {
  entries: EvidenceFeedEntry[];
}

export function EvidenceFeed({ entries }: EvidenceFeedProps) {
  if (entries.length === 0) return null;

  const recent = entries.slice(-15).reverse();

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">证据采集</h3>
        <span className="text-xs text-muted-foreground">{entries.length} 条证据</span>
      </div>
      <ScrollArea className="h-[140px] rounded border p-2">
        <div className="space-y-1.5">
          {recent.map((entry, i) => (
            <div key={i} className="flex items-start gap-2 text-xs">
              <FileText className="h-3 w-3 mt-0.5 text-muted-foreground shrink-0" />
              <span className="flex-1 truncate">{entry.source}</span>
              <Badge
                variant="outline"
                className={cn("text-[10px] shrink-0", CREDIBILITY_COLORS[entry.credibility])}
              >
                {CREDIBILITY_LABELS[entry.credibility]}
              </Badge>
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}

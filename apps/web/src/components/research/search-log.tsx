"use client";

import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Search } from "lucide-react";

interface SearchLogEntry {
  query: string;
  language: "zh" | "en";
  resultsCount: number;
  timestamp: string;
}

interface SearchLogProps {
  entries: SearchLogEntry[];
}

export function SearchLog({ entries }: SearchLogProps) {
  if (entries.length === 0) return null;

  const recent = entries.slice(-20).reverse();

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">搜索日志</h3>
        <span className="text-xs text-muted-foreground">{entries.length} 次搜索</span>
      </div>
      <ScrollArea className="h-[160px] rounded border p-2">
        <div className="space-y-1.5">
          {recent.map((entry, i) => (
            <div key={i} className="flex items-start gap-2 text-xs">
              <Search className="h-3 w-3 mt-0.5 text-muted-foreground shrink-0" />
              <span className="flex-1 truncate">{entry.query}</span>
              <Badge variant="outline" className="text-[10px] shrink-0">
                {entry.resultsCount} 条
              </Badge>
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}

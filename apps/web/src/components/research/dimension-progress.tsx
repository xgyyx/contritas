"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";

interface DimensionState {
  id: string;
  sourcesFound: number;
  round: number;
}

interface DimensionProgressProps {
  dimensions: Map<string, DimensionState>;
}

export function DimensionProgress({ dimensions }: DimensionProgressProps) {
  const items = Array.from(dimensions.values());

  if (items.length === 0) return null;

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium">研究维度</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {items.map((dim) => (
          <Card key={dim.id} className="shadow-none">
            <CardContent className="p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-mono text-muted-foreground truncate max-w-[120px]">
                  {dim.id.slice(0, 8)}...
                </span>
                <Badge variant="secondary" className="text-xs">
                  轮次 {dim.round}/5
                </Badge>
              </div>
              <Progress value={(dim.round / 5) * 100} className="h-1.5" />
              <p className="text-xs text-muted-foreground mt-1">
                已找到 {dim.sourcesFound} 条来源
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

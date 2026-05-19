"use client";

import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { STATUS_LABELS, STATUS_COLORS } from "@/lib/constants";
import { cn } from "@/lib/cn";
import type { HistoryEntry } from "@/stores/history-store";
import { Calendar, ArrowRight } from "lucide-react";

interface SessionCardProps {
  session: HistoryEntry;
}

export function SessionCard({ session }: SessionCardProps) {
  return (
    <Link href={`/research/${session.id}`}>
      <Card className="hover:shadow-md transition-shadow cursor-pointer">
        <CardContent className="p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{session.proposition}</p>
              <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Calendar className="h-3 w-3" />
                  {new Date(session.createdAt).toLocaleString("zh-CN")}
                </span>
                <Badge
                  variant="outline"
                  className={cn("text-[10px]", STATUS_COLORS[session.status])}
                >
                  {STATUS_LABELS[session.status]}
                </Badge>
              </div>
            </div>
            <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0 mt-1" />
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

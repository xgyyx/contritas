"use client";

import { useEffect } from "react";
import { useHistoryStore, type HistoryEntry } from "@/stores/history-store";
import { SessionCard } from "./session-card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import type { SessionStatus } from "@/types";
import Link from "next/link";
import { Plus, RefreshCw } from "lucide-react";

const FILTER_OPTIONS: Array<{ value: "all" | SessionStatus; label: string }> = [
  { value: "all", label: "全部" },
  { value: "in_progress", label: "进行中" },
  { value: "completed", label: "已完成" },
  { value: "failed", label: "失败" },
  { value: "cancelled", label: "已取消" },
];

export function SessionList() {
  const sessions = useHistoryStore((s) => s.sessions);
  const isLoading = useHistoryStore((s) => s.isLoading);
  const statusFilter = useHistoryStore((s) => s.statusFilter);
  const setFilter = useHistoryStore((s) => s.setFilter);
  const loadFromStorage = useHistoryStore((s) => s.loadFromStorage);
  const refreshSessions = useHistoryStore((s) => s.refreshSessions);

  useEffect(() => {
    loadFromStorage();
  }, [loadFromStorage]);

  useEffect(() => {
    if (sessions.length > 0) {
      refreshSessions();
    }
  }, [sessions.length > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered =
    statusFilter === "all"
      ? sessions
      : sessions.filter((s) => s.status === statusFilter);

  // Empty state
  if (!isLoading && sessions.length === 0) {
    return (
      <div className="text-center py-16">
        <p className="text-muted-foreground mb-4">还没有历史研究记录</p>
        <Link href="/">
          <Button>
            <Plus className="h-4 w-4 mr-2" />
            开始第一次研究
          </Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {FILTER_OPTIONS.map((opt) => (
            <button key={opt.value} onClick={() => setFilter(opt.value)} className="outline-none">
              <Badge
                variant={statusFilter === opt.value ? "default" : "outline"}
                className="cursor-pointer"
              >
                {opt.label}
              </Badge>
            </button>
          ))}
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={refreshSessions}
          disabled={isLoading}
        >
          <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {/* Session list */}
      {isLoading && sessions.length === 0 ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((session) => (
            <SessionCard key={session.id} session={session} />
          ))}
          {filtered.length === 0 && (
            <p className="text-center text-sm text-muted-foreground py-8">
              没有符合条件的记录
            </p>
          )}
        </div>
      )}
    </div>
  );
}

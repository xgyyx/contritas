"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { api } from "@/lib/api-client";
import { useHistoryStore } from "@/stores/history-store";
import { toast } from "sonner";
import { ArrowDownRight, Plus } from "lucide-react";

interface IteratePanelProps {
  sessionId: string;
}

export function IteratePanel({ sessionId }: IteratePanelProps) {
  const router = useRouter();
  const addSession = useHistoryStore((s) => s.addSession);
  const [mode, setMode] = useState<"idle" | "deep_dive" | "add_dimension">("idle");
  const [target, setTarget] = useState("");
  const [details, setDetails] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit() {
    if (isSubmitting) return;

    const type = mode === "deep_dive" ? "deep_dive" : "add_dimension";
    setIsSubmitting(true);

    try {
      const result = await api.iterate(sessionId, {
        type,
        target: target || undefined,
        details: details || undefined,
      });
      addSession(result.sessionId, `${type === "deep_dive" ? "深挖" : "新维度"}: ${target}`);
      toast.success("已创建迭代研究");
      router.push(`/research/${result.sessionId}`);
    } catch {
      toast.error("创建迭代研究失败");
    } finally {
      setIsSubmitting(false);
    }
  }

  if (mode === "idle") {
    return (
      <Card className="shadow-none border-dashed">
        <CardContent className="p-4 flex items-center gap-3">
          <span className="text-sm text-muted-foreground">想继续深入研究？</span>
          <Button variant="outline" size="sm" onClick={() => setMode("deep_dive")}>
            <ArrowDownRight className="h-4 w-4 mr-1" />
            深挖维度
          </Button>
          <Button variant="outline" size="sm" onClick={() => setMode("add_dimension")}>
            <Plus className="h-4 w-4 mr-1" />
            新增维度
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="shadow-none">
      <CardContent className="p-4 space-y-3">
        <h4 className="text-sm font-medium">
          {mode === "deep_dive" ? "深挖已有维度" : "新增研究维度"}
        </h4>
        <div className="space-y-2">
          <input
            type="text"
            placeholder={mode === "deep_dive" ? "目标维度名称或 ID" : "新维度名称"}
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
          />
          <Textarea
            placeholder="补充说明（可选）"
            value={details}
            onChange={(e) => setDetails(e.target.value)}
            className="min-h-[60px]"
          />
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={handleSubmit} disabled={!target || isSubmitting}>
            {isSubmitting ? "创建中..." : "开始迭代"}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => { setMode("idle"); setTarget(""); setDetails(""); }}>
            取消
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api-client";
import { useResearchStore } from "@/stores/research-store";
import { toast } from "sonner";

interface ClarificationDialogProps {
  sessionId: string;
  questions: string[];
  suggestedDirections: string[];
}

export function ClarificationDialog({
  sessionId,
  questions,
  suggestedDirections,
}: ClarificationDialogProps) {
  const [response, setResponse] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const clearClarification = useResearchStore((s) => s.clearClarification);
  const setStatus = useResearchStore((s) => s.setStatus);

  const isOpen = questions.length > 0;

  async function handleSubmit() {
    if (!response.trim() || isSubmitting) return;

    setIsSubmitting(true);
    try {
      await api.respond(sessionId, { response: response.trim() });
      clearClarification();
      setStatus("in_progress");
      setResponse("");
      toast.success("已提交回复");
    } catch {
      toast.error("提交失败，请重试");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog open={isOpen}>
      <DialogContent className="sm:max-w-lg" onPointerDownOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>需要补充信息</DialogTitle>
          <DialogDescription>
            研究 Agent 需要你的回复以继续进行
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-2">
            {questions.map((q, i) => (
              <p key={i} className="text-sm border-l-2 border-primary pl-3">
                {q}
              </p>
            ))}
          </div>

          {suggestedDirections.length > 0 && (
            <div className="flex flex-wrap gap-1">
              <span className="text-xs text-muted-foreground">建议方向：</span>
              {suggestedDirections.map((d, i) => (
                <Badge
                  key={i}
                  variant="outline"
                  className="text-xs cursor-pointer hover:bg-accent"
                  onClick={() => setResponse(d)}
                >
                  {d}
                </Badge>
              ))}
            </div>
          )}

          <Textarea
            placeholder="输入你的回复..."
            value={response}
            onChange={(e) => setResponse(e.target.value)}
            className="min-h-[80px]"
          />
        </div>

        <DialogFooter>
          <Button onClick={handleSubmit} disabled={!response.trim() || isSubmitting}>
            {isSubmitting ? "提交中..." : "提交回复"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

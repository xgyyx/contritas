"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api-client";
import { useResearchStore } from "@/stores/research-store";
import { toast } from "sonner";
import { XCircle } from "lucide-react";

interface CancelButtonProps {
  sessionId: string;
}

export function CancelButton({ sessionId }: CancelButtonProps) {
  const [isConfirming, setIsConfirming] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const setStatus = useResearchStore((s) => s.setStatus);
  const router = useRouter();

  async function handleCancel() {
    if (!isConfirming) {
      setIsConfirming(true);
      setTimeout(() => setIsConfirming(false), 3000);
      return;
    }

    setIsCancelling(true);
    try {
      await api.cancel(sessionId);
      setStatus("cancelled");
      toast.success("研究已取消");
      router.push("/");
    } catch {
      toast.error("取消失败");
    } finally {
      setIsCancelling(false);
      setIsConfirming(false);
    }
  }

  return (
    <Button
      variant={isConfirming ? "destructive" : "outline"}
      size="sm"
      onClick={handleCancel}
      disabled={isCancelling}
    >
      <XCircle className="h-4 w-4 mr-1" />
      {isCancelling ? "取消中..." : isConfirming ? "确认取消？" : "取消研究"}
    </Button>
  );
}

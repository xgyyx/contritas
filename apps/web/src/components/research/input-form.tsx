"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { api, ApiError } from "@/lib/api-client";
import { useHistoryStore } from "@/stores/history-store";
import { toast } from "sonner";

export function InputForm() {
  const router = useRouter();
  const [proposition, setProposition] = useState("");
  const [language, setLanguage] = useState<"zh" | "en">("zh");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const addSession = useHistoryStore((s) => s.addSession);

  const charCount = proposition.length;
  const isValid = charCount >= 10 && charCount <= 2000;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isValid || isSubmitting) return;

    setIsSubmitting(true);
    setError(null);

    try {
      const result = await api.createResearch({ proposition, language });
      addSession(result.sessionId, proposition);
      router.push(`/research/${result.sessionId}`);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 429) {
          setError("请求过于频繁，请稍后再试");
        } else {
          setError(err.message);
        }
      } else {
        setError("网络错误，请检查连接");
      }
      toast.error("提交失败");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Card className="w-full max-w-2xl mx-auto">
      <CardHeader>
        <CardTitle>开始新的尽职调查</CardTitle>
        <CardDescription>
          输入你的决策命题，Contritas 将自动拆解假设、多源检索、交叉验证，输出带置信度的尽调报告。
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Textarea
              placeholder="例如：投资某某公司的 A 轮融资是否值得推进？"
              value={proposition}
              onChange={(e) => setProposition(e.target.value)}
              className="min-h-[120px] resize-y"
              maxLength={2000}
              disabled={isSubmitting}
            />
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span className={charCount < 10 ? "text-destructive" : ""}>
                {charCount}/2000 字符 {charCount < 10 && "(至少 10 字符)"}
              </span>
              <div className="flex items-center gap-2">
                <span className="text-xs">研究语言：</span>
                <button
                  type="button"
                  onClick={() => setLanguage("zh")}
                  className="outline-none"
                >
                  <Badge variant={language === "zh" ? "default" : "outline"} className="cursor-pointer">
                    中文
                  </Badge>
                </button>
                <button
                  type="button"
                  onClick={() => setLanguage("en")}
                  className="outline-none"
                >
                  <Badge variant={language === "en" ? "default" : "outline"} className="cursor-pointer">
                    English
                  </Badge>
                </button>
              </div>
            </div>
          </div>

          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}

          <Button type="submit" className="w-full" disabled={!isValid || isSubmitting}>
            {isSubmitting ? "提交中..." : "开始研究"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

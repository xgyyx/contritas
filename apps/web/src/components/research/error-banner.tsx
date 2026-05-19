"use client";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertTriangle, XCircle } from "lucide-react";

interface ErrorEntry {
  message: string;
  recoverable: boolean;
  timestamp: string;
}

interface ErrorBannerProps {
  errors: ErrorEntry[];
}

export function ErrorBanner({ errors }: ErrorBannerProps) {
  if (errors.length === 0) return null;

  const latestError = errors[errors.length - 1];
  const isFatal = !latestError.recoverable;

  return (
    <Alert variant={isFatal ? "destructive" : "warning"}>
      {isFatal ? <XCircle className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
      <AlertTitle>{isFatal ? "研究失败" : "出现警告"}</AlertTitle>
      <AlertDescription>{latestError.message}</AlertDescription>
    </Alert>
  );
}

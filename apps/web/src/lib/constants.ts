import type { PhaseId, SessionStatus, Credibility, OverallVerdict, Relationship } from "@/types";

export const PHASE_LABELS: Record<PhaseId, string> = {
  inputValidation: "输入验证",
  decomposition: "假设拆解",
  planning: "研究规划",
  retrieval: "多源检索",
  validation: "交叉验证",
  synthesis: "报告综合",
};

export const PHASE_ORDER: PhaseId[] = [
  "inputValidation",
  "decomposition",
  "planning",
  "retrieval",
  "validation",
  "synthesis",
];

export const STATUS_LABELS: Record<SessionStatus, string> = {
  awaiting_input: "等待输入",
  in_progress: "进行中",
  completed: "已完成",
  failed: "失败",
  cancelled: "已取消",
};

export const STATUS_COLORS: Record<SessionStatus, string> = {
  awaiting_input: "text-yellow-600 bg-yellow-50 border-yellow-200",
  in_progress: "text-blue-600 bg-blue-50 border-blue-200",
  completed: "text-green-600 bg-green-50 border-green-200",
  failed: "text-red-600 bg-red-50 border-red-200",
  cancelled: "text-gray-600 bg-gray-50 border-gray-200",
};

export const CREDIBILITY_COLORS: Record<Credibility, string> = {
  high: "text-green-700 bg-green-100",
  medium: "text-yellow-700 bg-yellow-100",
  low: "text-red-700 bg-red-100",
};

export const CREDIBILITY_LABELS: Record<Credibility, string> = {
  high: "高",
  medium: "中",
  low: "低",
};

export const VERDICT_LABELS: Record<OverallVerdict, string> = {
  proceed: "建议推进",
  proceed_with_caution: "谨慎推进",
  hold: "建议暂缓",
  abandon: "建议放弃",
};

export const VERDICT_COLORS: Record<OverallVerdict, string> = {
  proceed: "text-green-700 bg-green-100 border-green-300",
  proceed_with_caution: "text-yellow-700 bg-yellow-100 border-yellow-300",
  hold: "text-orange-700 bg-orange-100 border-orange-300",
  abandon: "text-red-700 bg-red-100 border-red-300",
};

export const RELATIONSHIP_LABELS: Record<Relationship, string> = {
  supports: "支持",
  weakens: "削弱",
  qualifies: "限定",
};

export const RELATIONSHIP_COLORS: Record<Relationship, string> = {
  supports: "text-green-700",
  weakens: "text-red-700",
  qualifies: "text-yellow-700",
};

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
export const API_TOKEN = process.env.NEXT_PUBLIC_API_TOKEN ?? "";

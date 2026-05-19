import type { PhaseId, Credibility } from "./entities.js";

export type ProgressEvent =
  | PhaseChangeEvent
  | DimensionUpdateEvent
  | SearchExecutedEvent
  | EvidenceAddedEvent
  | ErrorEvent
  | EtaUpdateEvent
  | ReportReadyEvent
  | ClarificationEvent
  | ValidationCompleteEvent;

export interface PhaseChangeEvent {
  type: "phase_change";
  phase: PhaseId;
  status: "started" | "completed";
  timestamp: string;
}

export interface DimensionUpdateEvent {
  type: "dimension_update";
  dimensionId: string;
  sourcesFound: number;
  round: number;
  timestamp: string;
}

export interface SearchExecutedEvent {
  type: "search_executed";
  query: string;
  language: "zh" | "en";
  resultsCount: number;
  timestamp: string;
}

export interface EvidenceAddedEvent {
  type: "evidence_added";
  dimensionId: string;
  source: string;
  credibility: Credibility;
  timestamp: string;
}

export interface ErrorEvent {
  type: "error";
  message: string;
  recoverable: boolean;
  timestamp: string;
}

export interface EtaUpdateEvent {
  type: "eta_update";
  estimatedSecondsRemaining: number;
  timestamp: string;
}

export interface ReportReadyEvent {
  type: "report_ready";
  reportId: string;
  timestamp: string;
}

export interface ClarificationEvent {
  type: "clarification";
  questions: string[];
  suggestedDirections?: string[];
  timestamp: string;
}

export interface ValidationCompleteEvent {
  type: "validation_complete";
  contradictionsFound: number;
  timestamp: string;
}

import type {
  PhaseId,
  PhaseState,
  Language,
  ComplexityLevel,
  TokenUsage,
} from "@contritas/shared";
import type { LLMProvider } from "@contritas/llm";
import type { Phase0Output } from "@contritas/llm";

// ══════════════════════════════════════════
// Machine Context
// ══════════════════════════════════════════

export interface ResearchContext {
  sessionId: string;
  input: {
    originalText: string;
    validatedProposition?: string;
    language: Language;
  };
  assumptions: AssumptionData[];
  dimensions: DimensionData[];
  complexity?: ComplexityLevel;
  phases: PhaseState[];
  currentPhase: PhaseId;
  clarificationHistory: ClarificationEntry[];
  tokenUsage: TokenUsage;
  error?: string;
}

export interface AssumptionData {
  content: string;
  type: "factual" | "judgmental";
  importance: "high" | "medium" | "low";
  order: number;
}

export interface DimensionData {
  name: string;
  coreQuestion: string;
  counterQuestion: string;
  keywords: { zh: string[]; en: string[] };
  relatedAssumptionIndices: number[];
}

export interface ClarificationEntry {
  questions: string[];
  suggestedDirections?: string[];
  userResponse: string;
  timestamp: string;
}

// ══════════════════════════════════════════
// Machine Events
// ══════════════════════════════════════════

export type ResearchEvent =
  | { type: "START" }
  | { type: "USER_RESPONSE"; response: string }
  | { type: "CANCEL" };

// ══════════════════════════════════════════
// Actor Dependencies (injected)
// ══════════════════════════════════════════

export interface WorkflowDeps {
  llmProvider: LLMProvider;
  llmModel: string;
  emitEvent: (event: WorkflowEmittedEvent) => void;
  persistState: (context: ResearchContext) => Promise<void>;
}

export type WorkflowEmittedEvent =
  | { type: "phase_change"; phase: PhaseId; status: "started" | "completed" }
  | { type: "clarification"; questions: string[]; suggestedDirections?: string[] }
  | { type: "error"; message: string; recoverable: boolean };

// ══════════════════════════════════════════
// Actor Input/Output
// ══════════════════════════════════════════

export interface ValidateInputResult {
  valid: boolean;
  output: Phase0Output;
}

export interface DecomposeResult {
  assumptions: AssumptionData[];
  usage: TokenUsage;
}

export interface PlanResult {
  dimensions: DimensionData[];
  complexity: ComplexityLevel;
  estimatedMinutes: number;
  usage: TokenUsage;
}

import type {
  PhaseId,
  PhaseState,
  Language,
  ComplexityLevel,
  TokenUsage,
  Credibility,
} from "@contritas/shared";
import type { LLMProvider } from "@contritas/llm";
import type { Phase0Output } from "@contritas/llm";
import type {
  SearchProvider,
  ContentExtractor,
  SearchCache,
  SearchEventCallback,
} from "@contritas/search";

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
  evidence: EvidenceData[];
  complexity?: ComplexityLevel;
  phases: PhaseState[];
  currentPhase: PhaseId;
  clarificationHistory: ClarificationEntry[];
  tokenUsage: TokenUsage;
  searchCallsUsed: number;
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

export interface EvidenceData {
  dimensionId: string;
  url: string;
  title: string;
  sourceName: string;
  sourceType: string;
  credibility: string;
  publishedDate?: string;
  language: Language;
  keyExcerpt: string;
  relationship: string;
  timelinessRisk: boolean;
  searchQuery: string;
  searchRound: number;
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
// Search Dependencies
// ══════════════════════════════════════════

export interface SearchDeps {
  searchProvider: SearchProvider;
  fallbackSearchProvider?: SearchProvider;
  contentExtractor: ContentExtractor;
  cache?: SearchCache;
  searchConcurrencyLimit: number;
  extractConcurrencyLimit: number;
  maxSearchCallsPerSession: number;
  /** LLM model to use for evidence evaluation (can be cheaper model) */
  evidenceEvalModel?: string;
}

// ══════════════════════════════════════════
// Actor Dependencies (injected)
// ══════════════════════════════════════════

export interface WorkflowDeps {
  llmProvider: LLMProvider;
  llmModel: string;
  searchDeps?: SearchDeps;
  emitEvent: (event: WorkflowEmittedEvent) => void;
  persistState: (context: ResearchContext) => Promise<void>;
}

export type WorkflowEmittedEvent =
  | { type: "phase_change"; phase: PhaseId; status: "started" | "completed" }
  | { type: "clarification"; questions: string[]; suggestedDirections?: string[] }
  | { type: "error"; message: string; recoverable: boolean }
  | { type: "dimension_update"; dimensionId: string; sourcesFound: number; round: number }
  | { type: "search_executed"; query: string; language: Language; resultsCount: number }
  | { type: "evidence_added"; dimensionId: string; source: string; credibility: Credibility };

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

export interface RetrievalResult {
  evidence: EvidenceData[];
  searchCallsUsed: number;
  dimensionResults: Array<{
    dimensionId: string;
    sufficient: boolean;
    roundsUsed: number;
  }>;
}

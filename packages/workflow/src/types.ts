import type {
  PhaseId,
  PhaseState,
  Language,
  ComplexityLevel,
  TokenUsage,
  Credibility,
  Verdict,
  Confidence,
  ContradictionReason,
  OverallVerdict,
} from "@contritas/shared";
import type { LLMProvider } from "@contritas/llm";
import type { Phase0Output } from "@contritas/llm";
import type {
  SearchProvider,
  ContentExtractor,
  SearchCache,
  ContentCache,
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
  crossValidations: CrossValidationData[];
  report?: ReportData;
  complexity?: ComplexityLevel;
  phases: PhaseState[];
  currentPhase: PhaseId;
  clarificationHistory: ClarificationEntry[];
  tokenUsage: TokenUsage;
  searchCallsUsed: number;
  selfCheckRetries: number;
  targetedDimensions?: string[];
  error?: string;
}

export interface AssumptionData {
  id: string;
  content: string;
  type: "factual" | "judgmental";
  importance: "high" | "medium" | "low";
  order: number;
}

export interface DimensionData {
  id: string;
  name: string;
  coreQuestion: string;
  counterQuestion: string;
  keywords: { zh: string[]; en: string[] };
  relatedAssumptionIndices: number[];
}

export interface EvidenceData {
  id: string;
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
  contentCache?: ContentCache;
  searchConcurrencyLimit: number;
  extractConcurrencyLimit: number;
  maxSearchCallsPerSession: number;
  /**
   * LLM model used for evidence evaluation and keyword refinement (cheap tier).
   * If unset, search-dimensions falls back to getModelForPhase("retrieval").
   */
  evidenceEvalModel?: string;
}

// ══════════════════════════════════════════
// Actor Dependencies (injected)
// ══════════════════════════════════════════

export interface WorkflowDeps {
  llmProvider: LLMProvider;
  getModelForPhase: (phase: PhaseId) => string;
  searchDeps?: SearchDeps;
  tokenBudgetUSD?: number;
  emitEvent: (event: WorkflowEmittedEvent) => void;
  persistState: (context: ResearchContext) => Promise<void>;
}

export type WorkflowEmittedEvent =
  | { type: "phase_change"; phase: PhaseId; status: "started" | "completed" }
  | { type: "clarification"; questions: string[]; suggestedDirections?: string[] }
  | { type: "error"; message: string; recoverable: boolean }
  | { type: "dimension_update"; dimensionId: string; sourcesFound: number; round: number }
  | { type: "search_executed"; query: string; language: Language; resultsCount: number }
  | { type: "evidence_added"; dimensionId: string; source: string; credibility: Credibility }
  | { type: "validation_complete"; contradictionsFound: number }
  | { type: "report_ready"; reportId: string }
  | { type: "eta_update"; estimatedSecondsRemaining: number };

// ══════════════════════════════════════════
// Actor Input/Output
// ══════════════════════════════════════════

export interface ValidateInputResult {
  valid: boolean;
  output: Phase0Output;
}

// Decompose / plan / cross-validate actors return entities without an id; the state machine
// assigns stable ids in their onDone actions before storing them on the context.
export type AssumptionDraft = Omit<AssumptionData, "id">;
export type DimensionDraft = Omit<DimensionData, "id">;

export interface DecomposeResult {
  assumptions: AssumptionDraft[];
  usage: TokenUsage;
}

export interface PlanResult {
  dimensions: DimensionDraft[];
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

// ══════════════════════════════════════════
// Phase 4: Cross-Validation
// ══════════════════════════════════════════

export interface CrossValidationData {
  id: string;
  dimensionId: string;
  evidenceIds: string[];
  consistent: boolean;
  contradictionDescription?: string;
  contradictionReason?: ContradictionReason;
  verdict: Verdict;
  confidence: Confidence;
}

export type CrossValidationDraft = Omit<CrossValidationData, "id">;

export interface CrossValidationResult {
  crossValidations: CrossValidationDraft[];
  usage: TokenUsage;
}

// ══════════════════════════════════════════
// Phase 5: Synthesis & Report
// ══════════════════════════════════════════

export interface ReportData {
  markdownContent: string;
  overallScore: string;
  overallVerdict: OverallVerdict;
  charCount: number;
  sourceCount: number;
}

export interface SelfCheckFailure {
  check: string;
  dimensionId?: string;
  reason: string;
}

export interface SelfCheckResult {
  passed: boolean;
  failedChecks: SelfCheckFailure[];
}

export interface SynthesisResult {
  report: ReportData;
  selfCheck: SelfCheckResult;
  usage: TokenUsage;
}

// ══════════════════════════════════════════
// Enums / Unions
// ══════════════════════════════════════════

export type SessionStatus = "awaiting_input" | "in_progress" | "completed" | "failed" | "cancelled";

export type PhaseId =
  | "inputValidation"
  | "decomposition"
  | "planning"
  | "retrieval"
  | "validation"
  | "synthesis";

export type ComplexityLevel = "low" | "medium" | "high";

export type AssumptionType = "factual" | "judgmental";

export type ImportanceLevel = "high" | "medium" | "low";

export type Verdict = "supported" | "disputed" | "unsupported";

export type EvidenceStrength = "strong" | "medium" | "weak";

export type Confidence = "high" | "medium" | "low";

export type SourceType =
  | "official_doc"
  | "statistics"
  | "academic"
  | "industry_report"
  | "case_study"
  | "community"
  | "media";

export type Credibility = "high" | "medium" | "low";

export type Relationship = "supports" | "weakens" | "qualifies";

export type OverallVerdict = "proceed" | "proceed_with_caution" | "hold" | "abandon";

export type ContradictionReason =
  | "source_bias"
  | "time_difference"
  | "scope_mismatch"
  | "methodology_difference";

export type Language = "zh" | "en";

// ══════════════════════════════════════════
// Phase State
// ══════════════════════════════════════════

export interface PhaseState {
  id: PhaseId;
  status: "pending" | "started" | "completed" | "failed";
  startedAt?: string;
  completedAt?: string;
  error?: string;
}

// ══════════════════════════════════════════
// Entities
// ══════════════════════════════════════════

export interface ResearchSession {
  id: string;
  status: SessionStatus;
  input: {
    originalText: string;
    validatedProposition?: string;
    language: Language;
  };
  complexity?: ComplexityLevel;
  config: {
    llmProvider: string;
    llmModel: string;
    searchProvider?: string;
  };
  phases: PhaseState[];
  tokenUsage: TokenUsage;
  searchCallsUsed: number;
  parentSessionId?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUSD: number;
}

export interface Assumption {
  id: string;
  sessionId: string;
  content: string;
  type: AssumptionType;
  importance: ImportanceLevel;
  order: number;
  verdict?: Verdict;
  evidenceStrength?: EvidenceStrength;
}

export interface Dimension {
  id: string;
  sessionId: string;
  name: string;
  coreQuestion: string;
  counterQuestion: string;
  assumptionIds: string[];
  keywords: { zh: string[]; en: string[] };
  status: "pending" | "searching" | "completed" | "insufficient";
  currentRound: number;
  maxRounds: number;
  sourcesFound: number;
  highCredibilitySources: number;
  verdict?: Verdict;
  confidence?: Confidence;
  weight?: ImportanceLevel;
}

export interface Evidence {
  id: string;
  sessionId: string;
  dimensionId: string;
  searchQuery: string;
  searchRound: number;
  url: string;
  title?: string;
  sourceName?: string;
  sourceType: SourceType;
  credibility: Credibility;
  publishedDate?: string;
  language: Language;
  keyExcerpt: string;
  relationship: Relationship;
  timelinessRisk: boolean;
  retrievedAt: string;
}

export interface CrossValidation {
  id: string;
  sessionId: string;
  dimensionId: string;
  evidenceIds: string[];
  consistent: boolean;
  contradictionDescription?: string;
  contradictionReason?: ContradictionReason;
}

export interface Report {
  id: string;
  sessionId: string;
  version: number;
  markdownContent: string;
  overallScore?: string;
  overallVerdict?: OverallVerdict;
  charCount?: number;
  sourceCount?: number;
  generatedAt: string;
}

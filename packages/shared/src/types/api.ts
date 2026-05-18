import type { SessionStatus, PhaseState, ComplexityLevel, TokenUsage } from "./entities.js";

// ══════════════════════════════════════════
// POST /api/research
// ══════════════════════════════════════════

export interface CreateResearchRequest {
  proposition: string;
  language?: "zh" | "en";
  config?: {
    llmProvider?: string;
    llmModel?: string;
    searchProvider?: string;
  };
}

export interface CreateResearchResponse {
  sessionId: string;
  status: SessionStatus;
}

// ══════════════════════════════════════════
// GET /api/research/:id
// ══════════════════════════════════════════

export interface SessionStatusResponse {
  id: string;
  status: SessionStatus;
  input: {
    originalText: string;
    validatedProposition?: string;
    language: "zh" | "en";
  };
  complexity?: ComplexityLevel;
  phases: PhaseState[];
  tokenUsage: TokenUsage;
  searchCallsUsed: number;
  assumptionCount: number;
  dimensionCount: number;
  evidenceCount: number;
  createdAt: string;
  completedAt?: string;
}

// ══════════════════════════════════════════
// POST /api/research/:id/respond
// ══════════════════════════════════════════

export interface UserRespondRequest {
  response: string;
}

// ══════════════════════════════════════════
// DELETE /api/research/:id
// ══════════════════════════════════════════

export interface CancelResearchResponse {
  success: boolean;
  sessionId: string;
}

// ══════════════════════════════════════════
// POST /api/research/:id/iterate
// ══════════════════════════════════════════

export interface IterateResearchRequest {
  type: "deep_dive" | "add_dimension";
  target?: string; // dimensionId for deep_dive, dimension name for add
  details?: string;
}

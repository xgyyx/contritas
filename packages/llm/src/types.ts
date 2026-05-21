import type { z } from "zod";
import type { PhaseId } from "@contritas/shared";

// ══════════════════════════════════════════
// Message Types
// ══════════════════════════════════════════

export type MessageRole = "user" | "assistant" | "system";

export interface Message {
  role: MessageRole;
  content: string;
}

// ══════════════════════════════════════════
// Provider Interface
// ══════════════════════════════════════════

export interface ModelInfo {
  id: string;
  name: string;
  contextWindow: number;
  maxOutput: number;
  costPerInputToken: number; // USD
  costPerOutputToken: number; // USD
}

export interface ChatParams {
  model: string;
  messages: Message[];
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
  /**
   * Mark the system prompt as cacheable (Anthropic ephemeral cache). Ignored by
   * non-Claude providers. Use for actors with large stable system prompts
   * (e.g. synthesis, cross-validation).
   */
  cacheSystem?: boolean;
}

export interface ChatResponse {
  content: string;
  usage: TokenUsage;
  finishReason: "stop" | "length" | "tool_use";
}

export interface ChatChunk {
  content: string;
  done: boolean;
}

export interface StructuredParams<T> {
  model: string;
  messages: Message[];
  schema: z.ZodSchema<T>;
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  cacheSystem?: boolean;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUSD: number;
  /** Anthropic prompt cache: tokens served from cache (10% input price). */
  cacheReadInputTokens?: number;
  /** Anthropic prompt cache: tokens written to cache (125% input price). */
  cacheCreationInputTokens?: number;
}

export interface LLMProvider {
  readonly name: string;
  readonly models: ModelInfo[];

  chat(params: ChatParams): Promise<ChatResponse>;
  chatStream(params: ChatParams): AsyncIterable<ChatChunk>;
  structuredOutput<T>(params: StructuredParams<T>): Promise<{ data: T; usage: TokenUsage }>;
}

// ══════════════════════════════════════════
// Model Routing
// ══════════════════════════════════════════

export interface ModelRef {
  provider: string;
  model: string;
}

export interface ModelRoutingConfig {
  inputValidation: ModelRef;
  decomposition: ModelRef;
  planning: ModelRef;
  evidenceExtraction: ModelRef;
  crossValidation: ModelRef;
  synthesis: ModelRef;
}

export type PhaseToRouteKey = Record<PhaseId, keyof ModelRoutingConfig>;

// ── Tiered routing (Sprint C) ───────────────────────────────────────────────
// Two-tier policy: `default` for reasoning-heavy phases, `cheap` for mechanical
// extraction. Concrete model ids are bound per-environment via env vars; the
// tier-to-phase mapping is held constant in DEFAULT_PHASE_TIERS.

export type ModelTier = "default" | "cheap";

export interface TieredRoutingConfig {
  default: ModelRef;
  cheap: ModelRef;
}

export type PhaseToTier = Record<PhaseId, ModelTier>;

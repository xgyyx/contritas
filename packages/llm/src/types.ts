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
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUSD: number;
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

import type { PhaseId } from "@contritas/shared";
import type {
  LLMProvider,
  ModelRef,
  ModelRoutingConfig,
  ModelTier,
  PhaseToRouteKey,
  PhaseToTier,
} from "./types.js";

const PHASE_TO_ROUTE_KEY: PhaseToRouteKey = {
  inputValidation: "inputValidation",
  decomposition: "decomposition",
  planning: "planning",
  retrieval: "evidenceExtraction",
  validation: "crossValidation",
  synthesis: "synthesis",
};

/**
 * Sprint C policy: which tier each pipeline phase runs on. Cheap-tier phases
 * are mechanical (extraction, validation, classification) where a Haiku-class
 * model is sufficient. Default-tier phases drive research quality and warrant
 * the premium model.
 */
export const DEFAULT_PHASE_TIERS: PhaseToTier = {
  inputValidation: "cheap",
  decomposition: "default",
  planning: "default",
  retrieval: "cheap",
  validation: "default",
  synthesis: "default",
};

export class ModelRouter {
  private config: ModelRoutingConfig;

  constructor(config: ModelRoutingConfig) {
    this.config = config;
  }

  getModelForPhase(phase: PhaseId): ModelRef {
    const key = PHASE_TO_ROUTE_KEY[phase];
    return this.config[key];
  }

  updateConfig(config: Partial<ModelRoutingConfig>): void {
    this.config = { ...this.config, ...config };
  }
}

/**
 * Build a routing config from a (default, cheap) model pair plus a phase→tier
 * policy. This is the canonical Sprint C constructor.
 */
export function createTieredRoutingConfig(
  provider: string,
  defaultModel: string,
  cheapModel: string,
  tierPolicy: PhaseToTier = DEFAULT_PHASE_TIERS
): ModelRoutingConfig {
  const defaultRef: ModelRef = { provider, model: defaultModel };
  const cheapRef: ModelRef = { provider, model: cheapModel };
  const pick = (t: ModelTier) => (t === "cheap" ? cheapRef : defaultRef);

  return {
    inputValidation: pick(tierPolicy.inputValidation),
    decomposition: pick(tierPolicy.decomposition),
    planning: pick(tierPolicy.planning),
    evidenceExtraction: pick(tierPolicy.retrieval),
    crossValidation: pick(tierPolicy.validation),
    synthesis: pick(tierPolicy.synthesis),
  };
}

/**
 * Backwards-compatible single-model routing. Equivalent to
 * createTieredRoutingConfig(provider, model, model).
 */
export function createDefaultRoutingConfig(
  provider: string,
  model: string
): ModelRoutingConfig {
  return createTieredRoutingConfig(provider, model, model);
}

/**
 * Look up the model's max output token count from the provider's registry.
 * Falls back to a conservative 4096 when the model isn't registered (common
 * for the OpenAI-compatible provider where models are user-supplied).
 */
export function getModelMaxOutput(provider: LLMProvider, model: string): number {
  const info = provider.models.find((m) => m.id === model);
  return info?.maxOutput ?? 4096;
}

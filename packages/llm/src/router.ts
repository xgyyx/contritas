import type { PhaseId } from "@contritas/shared";
import type { ModelRef, ModelRoutingConfig, PhaseToRouteKey } from "./types.js";

const PHASE_TO_ROUTE_KEY: PhaseToRouteKey = {
  inputValidation: "inputValidation",
  decomposition: "decomposition",
  planning: "planning",
  retrieval: "evidenceExtraction",
  validation: "crossValidation",
  synthesis: "synthesis",
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
 * Creates a default routing config that uses a single model for all phases.
 * This is the Phase 1 simplified version.
 */
export function createDefaultRoutingConfig(
  provider: string,
  model: string
): ModelRoutingConfig {
  const ref: ModelRef = { provider, model };
  return {
    inputValidation: ref,
    decomposition: ref,
    planning: ref,
    evidenceExtraction: ref,
    crossValidation: ref,
    synthesis: ref,
  };
}

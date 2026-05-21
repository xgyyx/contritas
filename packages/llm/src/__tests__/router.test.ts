import { describe, it, expect } from "vitest";
import {
  ModelRouter,
  createTieredRoutingConfig,
  createDefaultRoutingConfig,
  getModelMaxOutput,
  DEFAULT_PHASE_TIERS,
} from "../router.js";
import { ClaudeProvider } from "../providers/claude.js";

describe("createTieredRoutingConfig", () => {
  it("routes phases to default and cheap models per DEFAULT_PHASE_TIERS", () => {
    const cfg = createTieredRoutingConfig("claude", "default-x", "cheap-x");
    const router = new ModelRouter(cfg);

    // cheap-tier phases
    expect(router.getModelForPhase("inputValidation").model).toBe("cheap-x");
    expect(router.getModelForPhase("retrieval").model).toBe("cheap-x");

    // default-tier phases
    expect(router.getModelForPhase("decomposition").model).toBe("default-x");
    expect(router.getModelForPhase("planning").model).toBe("default-x");
    expect(router.getModelForPhase("validation").model).toBe("default-x");
    expect(router.getModelForPhase("synthesis").model).toBe("default-x");
  });

  it("respects a custom tier policy override", () => {
    const cfg = createTieredRoutingConfig("claude", "D", "C", {
      ...DEFAULT_PHASE_TIERS,
      synthesis: "cheap",
    });
    expect(new ModelRouter(cfg).getModelForPhase("synthesis").model).toBe("C");
  });
});

describe("createDefaultRoutingConfig (legacy shim)", () => {
  it("uses the same model for every phase", () => {
    const router = new ModelRouter(createDefaultRoutingConfig("claude", "only"));
    for (const phase of [
      "inputValidation",
      "decomposition",
      "planning",
      "retrieval",
      "validation",
      "synthesis",
    ] as const) {
      expect(router.getModelForPhase(phase).model).toBe("only");
    }
  });
});

describe("getModelMaxOutput", () => {
  // Claude provider has a known models registry; instantiate it directly with
  // a dummy API key. We never make a real request so the key doesn't matter.
  const provider = new ClaudeProvider("test-key");

  it("returns the registered maxOutput for a known model", () => {
    expect(getModelMaxOutput(provider, "claude-sonnet-4-20250514")).toBe(16384);
    expect(getModelMaxOutput(provider, "claude-haiku-3-5-20241022")).toBe(8192);
  });

  it("falls back to 4096 for an unknown model", () => {
    expect(getModelMaxOutput(provider, "totally-unknown-model")).toBe(4096);
  });
});

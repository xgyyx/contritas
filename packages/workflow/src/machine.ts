import { setup, assign, type AnyEventObject } from "xstate";
import { MAX_SELF_CHECK_RETRIES, DEFAULT_TOKEN_BUDGET_USD, generateId } from "@contritas/shared";
import type {
  ResearchContext,
  ResearchEvent,
  WorkflowDeps,
  ValidateInputResult,
  RetrievalResult,
  CrossValidationResult,
  SynthesisResult,
} from "./types.js";
import { validateInput } from "./actors/validate-input.js";
import { decompose } from "./actors/decompose.js";
import { plan } from "./actors/plan.js";
import { searchDimensions } from "./actors/search-dimensions.js";
import { crossValidate } from "./actors/cross-validate.js";
import { synthesizeReport } from "./actors/synthesize-report.js";

export function createResearchMachine(deps: WorkflowDeps, initialState: string = "inputValidation") {
  return setup({
    types: {
      context: {} as ResearchContext,
      events: {} as ResearchEvent,
      input: {} as ResearchContext,
    },
    actors: {
      validateInput,
      decompose,
      plan,
      searchDimensions,
      crossValidate,
      synthesizeReport,
    },
    guards: {
      inputValid: ({ event }: { event: AnyEventObject }) => {
        return event.output?.valid === true;
      },
      needsClarification: ({ event }: { event: AnyEventObject }) => {
        const output = event.output;
        return (
          output?.valid === false &&
          (output?.output?.clarificationQuestions?.length ?? 0) > 0
        );
      },
    },
  }).createMachine({
    id: "research",
    initial: initialState as any,
    context: ({ input }) => input,

    states: {
      // Phase 0: Input Validation
      inputValidation: {
        entry: [
          assign({ currentPhase: () => "inputValidation" as const }),
          () => { deps.emitEvent({ type: "phase_change", phase: "inputValidation", status: "started" }); },
        ],
        invoke: {
          src: "validateInput",
          input: ({ context }) => ({ context, deps }),
          onDone: [
            {
              guard: "inputValid",
              target: "decomposition",
              actions: [
                assign({
                  input: ({ context, event }) => ({
                    ...context.input,
                    validatedProposition: (event.output as ValidateInputResult).output.validatedProposition ?? context.input.originalText,
                    language: (event.output as ValidateInputResult).output.detectedLanguage,
                  }),
                  phases: ({ context }) => [
                    ...context.phases.filter((p) => p.id !== "inputValidation"),
                    { id: "inputValidation" as const, status: "completed" as const, completedAt: new Date().toISOString() },
                  ],
                }),
                () => { deps.emitEvent({ type: "phase_change", phase: "inputValidation", status: "completed" }); },
                ({ context }) => { deps.persistState(context); },
              ],
            },
            {
              guard: "needsClarification",
              target: "awaitingClarification",
              actions: [
                assign({
                  phases: ({ context }) => [
                    ...context.phases.filter((p) => p.id !== "inputValidation"),
                    { id: "inputValidation" as const, status: "started" as const, startedAt: new Date().toISOString() },
                  ],
                }),
                ({ event }) => {
                  const result = event.output as ValidateInputResult;
                  deps.emitEvent({
                    type: "clarification",
                    questions: result.output.clarificationQuestions ?? [],
                    suggestedDirections: result.output.suggestedDirections,
                  });
                },
                ({ context }) => { deps.persistState(context); },
              ],
            },
            {
              // Invalid without clarification questions
              target: "failed",
              actions: [
                assign({ error: ({ event }) => (event.output as ValidateInputResult).output.reason ?? "Invalid input" }),
                () => { deps.emitEvent({ type: "error", message: "Input is not a valid research proposition", recoverable: false }); },
              ],
            },
          ],
          onError: {
            target: "failed",
            actions: [
              assign({ error: ({ event }) => String(event.error) }),
              () => { deps.emitEvent({ type: "error", message: "Input validation failed", recoverable: false }); },
            ],
          },
        },
      },

      // Waiting for user clarification
      awaitingClarification: {
        on: {
          USER_RESPONSE: {
            target: "inputValidation",
            actions: assign({
              clarificationHistory: ({ context, event }) => [
                ...context.clarificationHistory,
                {
                  questions: [],
                  userResponse: event.response,
                  timestamp: new Date().toISOString(),
                },
              ],
            }),
          },
          CANCEL: { target: "cancelled" },
        },
      },

      // Phase 1: Assumption Decomposition
      decomposition: {
        entry: [
          assign({ currentPhase: () => "decomposition" as const }),
          () => { deps.emitEvent({ type: "phase_change", phase: "decomposition", status: "started" }); },
        ],
        invoke: {
          src: "decompose",
          input: ({ context }) => ({ context, deps }),
          onDone: [
            {
              guard: ({ context, event }: { context: ResearchContext; event: AnyEventObject }) => {
                const budget = deps.tokenBudgetUSD ?? DEFAULT_TOKEN_BUDGET_USD;
                const newCost = context.tokenUsage.estimatedCostUSD + (event.output?.usage?.estimatedCostUSD ?? 0);
                return newCost >= budget;
              },
              target: "budgetExceeded",
              actions: [
                assign({
                  assumptions: ({ event }) => event.output.assumptions.map((a: any) => ({ ...a, id: a.id ?? generateId() })),
                  tokenUsage: ({ context, event }) => ({
                    inputTokens: context.tokenUsage.inputTokens + event.output.usage.inputTokens,
                    outputTokens: context.tokenUsage.outputTokens + event.output.usage.outputTokens,
                    totalTokens: context.tokenUsage.totalTokens + event.output.usage.totalTokens,
                    estimatedCostUSD: context.tokenUsage.estimatedCostUSD + event.output.usage.estimatedCostUSD,
                  }),
                }),
                ({ context }) => {
                  deps.emitEvent({
                    type: "error",
                    message: `Token budget exceeded ($${context.tokenUsage.estimatedCostUSD.toFixed(4)} / $${deps.tokenBudgetUSD ?? DEFAULT_TOKEN_BUDGET_USD})`,
                    recoverable: false,
                  });
                },
              ],
            },
            {
              target: "planning",
              actions: [
                assign({
                  assumptions: ({ event }) => event.output.assumptions.map((a: any) => ({ ...a, id: a.id ?? generateId() })),
                  tokenUsage: ({ context, event }) => ({
                    inputTokens: context.tokenUsage.inputTokens + event.output.usage.inputTokens,
                    outputTokens: context.tokenUsage.outputTokens + event.output.usage.outputTokens,
                    totalTokens: context.tokenUsage.totalTokens + event.output.usage.totalTokens,
                    estimatedCostUSD: context.tokenUsage.estimatedCostUSD + event.output.usage.estimatedCostUSD,
                  }),
                  phases: ({ context }) => [
                    ...context.phases.filter((p) => p.id !== "decomposition"),
                    { id: "decomposition" as const, status: "completed" as const, completedAt: new Date().toISOString() },
                  ],
                }),
                () => { deps.emitEvent({ type: "phase_change", phase: "decomposition", status: "completed" }); },
                ({ context }) => { deps.persistState(context); },
              ],
            },
          ],
          onError: {
            target: "failed",
            actions: [
              assign({ error: ({ event }) => String(event.error) }),
              () => { deps.emitEvent({ type: "error", message: "Assumption decomposition failed", recoverable: false }); },
            ],
          },
        },
      },

      // Phase 2: Research Planning
      planning: {
        entry: [
          assign({ currentPhase: () => "planning" as const }),
          () => { deps.emitEvent({ type: "phase_change", phase: "planning", status: "started" }); },
        ],
        invoke: {
          src: "plan",
          input: ({ context }) => ({ context, deps }),
          onDone: [
            {
              guard: ({ context, event }: { context: ResearchContext; event: AnyEventObject }) => {
                const budget = deps.tokenBudgetUSD ?? DEFAULT_TOKEN_BUDGET_USD;
                const newCost = context.tokenUsage.estimatedCostUSD + (event.output?.usage?.estimatedCostUSD ?? 0);
                return newCost >= budget;
              },
              target: "budgetExceeded",
              actions: [
                assign({
                  dimensions: ({ event }) => event.output.dimensions.map((d: any) => ({ ...d, id: d.id ?? generateId() })),
                  complexity: ({ event }) => event.output.complexity,
                  tokenUsage: ({ context, event }) => ({
                    inputTokens: context.tokenUsage.inputTokens + event.output.usage.inputTokens,
                    outputTokens: context.tokenUsage.outputTokens + event.output.usage.outputTokens,
                    totalTokens: context.tokenUsage.totalTokens + event.output.usage.totalTokens,
                    estimatedCostUSD: context.tokenUsage.estimatedCostUSD + event.output.usage.estimatedCostUSD,
                  }),
                }),
                ({ context }) => {
                  deps.emitEvent({
                    type: "error",
                    message: `Token budget exceeded ($${context.tokenUsage.estimatedCostUSD.toFixed(4)} / $${deps.tokenBudgetUSD ?? DEFAULT_TOKEN_BUDGET_USD})`,
                    recoverable: false,
                  });
                },
              ],
            },
            {
              target: "retrieval",
              actions: [
                assign({
                  dimensions: ({ event }) => event.output.dimensions.map((d: any) => ({ ...d, id: d.id ?? generateId() })),
                  complexity: ({ event }) => event.output.complexity,
                  tokenUsage: ({ context, event }) => ({
                    inputTokens: context.tokenUsage.inputTokens + event.output.usage.inputTokens,
                    outputTokens: context.tokenUsage.outputTokens + event.output.usage.outputTokens,
                    totalTokens: context.tokenUsage.totalTokens + event.output.usage.totalTokens,
                    estimatedCostUSD: context.tokenUsage.estimatedCostUSD + event.output.usage.estimatedCostUSD,
                  }),
                  phases: ({ context }) => [
                    ...context.phases.filter((p) => p.id !== "planning"),
                    { id: "planning" as const, status: "completed" as const, completedAt: new Date().toISOString() },
                  ],
                }),
                () => { deps.emitEvent({ type: "phase_change", phase: "planning", status: "completed" }); },
                ({ event }) => {
                  const estimatedMinutes = event.output.estimatedMinutes;
                  if (estimatedMinutes > 0) {
                    deps.emitEvent({
                      type: "eta_update",
                      estimatedSecondsRemaining: estimatedMinutes * 60,
                    });
                  }
                },
                ({ context }) => { deps.persistState(context); },
              ],
            },
          ],
          onError: {
            target: "failed",
            actions: [
              assign({ error: ({ event }) => String(event.error) }),
              () => { deps.emitEvent({ type: "error", message: "Research planning failed", recoverable: false }); },
            ],
          },
        },
      },

      // Phase 3: Multi-source Retrieval
      retrieval: {
        entry: [
          assign({ currentPhase: () => "retrieval" as const }),
          () => { deps.emitEvent({ type: "phase_change", phase: "retrieval", status: "started" }); },
        ],
        invoke: {
          src: "searchDimensions",
          input: ({ context }) => ({ context, deps }),
          onDone: {
            target: "validation",
            actions: [
              assign({
                evidence: ({ context, event }) => {
                  const newEvidence = (event.output as RetrievalResult).evidence;
                  // On retry, merge with existing evidence (avoid duplicates by URL)
                  if (context.selfCheckRetries > 0) {
                    const existingUrls = new Set(context.evidence.map((e) => e.url));
                    const unique = newEvidence.filter((e) => !existingUrls.has(e.url));
                    return [...context.evidence, ...unique];
                  }
                  return newEvidence;
                },
                searchCallsUsed: ({ context, event }) =>
                  context.searchCallsUsed + (event.output as RetrievalResult).searchCallsUsed,
                targetedDimensions: () => undefined,
                phases: ({ context }) => [
                  ...context.phases.filter((p) => p.id !== "retrieval"),
                  { id: "retrieval" as const, status: "completed" as const, completedAt: new Date().toISOString() },
                ],
              }),
              () => { deps.emitEvent({ type: "phase_change", phase: "retrieval", status: "completed" }); },
              ({ context }) => { deps.persistState(context); },
            ],
          },
          onError: {
            target: "failed",
            actions: [
              assign({ error: ({ event }) => String(event.error) }),
              () => { deps.emitEvent({ type: "error", message: "Multi-source retrieval failed", recoverable: false }); },
            ],
          },
        },
      },

      // Phase 4: Cross-Validation
      validation: {
        entry: [
          assign({ currentPhase: () => "validation" as const }),
          () => { deps.emitEvent({ type: "phase_change", phase: "validation", status: "started" }); },
        ],
        invoke: {
          src: "crossValidate",
          input: ({ context }) => ({ context, deps }),
          onDone: [
            {
              guard: ({ context, event }: { context: ResearchContext; event: AnyEventObject }) => {
                const budget = deps.tokenBudgetUSD ?? DEFAULT_TOKEN_BUDGET_USD;
                const usage = (event.output as CrossValidationResult)?.usage;
                const newCost = context.tokenUsage.estimatedCostUSD + (usage?.estimatedCostUSD ?? 0);
                return newCost >= budget;
              },
              target: "budgetExceeded",
              actions: [
                assign({
                  crossValidations: ({ event }) => (event.output as CrossValidationResult).crossValidations.map((cv) => ({ ...cv, id: generateId() })),
                  tokenUsage: ({ context, event }) => {
                    const usage = (event.output as CrossValidationResult).usage;
                    return {
                      inputTokens: context.tokenUsage.inputTokens + usage.inputTokens,
                      outputTokens: context.tokenUsage.outputTokens + usage.outputTokens,
                      totalTokens: context.tokenUsage.totalTokens + usage.totalTokens,
                      estimatedCostUSD: context.tokenUsage.estimatedCostUSD + usage.estimatedCostUSD,
                    };
                  },
                }),
                ({ context }) => {
                  deps.emitEvent({
                    type: "error",
                    message: `Token budget exceeded ($${context.tokenUsage.estimatedCostUSD.toFixed(4)} / $${deps.tokenBudgetUSD ?? DEFAULT_TOKEN_BUDGET_USD})`,
                    recoverable: false,
                  });
                },
              ],
            },
            {
              target: "synthesis",
              actions: [
                assign({
                  crossValidations: ({ event }) => (event.output as CrossValidationResult).crossValidations.map((cv) => ({ ...cv, id: generateId() })),
                  tokenUsage: ({ context, event }) => {
                    const usage = (event.output as CrossValidationResult).usage;
                    return {
                      inputTokens: context.tokenUsage.inputTokens + usage.inputTokens,
                      outputTokens: context.tokenUsage.outputTokens + usage.outputTokens,
                      totalTokens: context.tokenUsage.totalTokens + usage.totalTokens,
                      estimatedCostUSD: context.tokenUsage.estimatedCostUSD + usage.estimatedCostUSD,
                    };
                  },
                  phases: ({ context }) => [
                    ...context.phases.filter((p) => p.id !== "validation"),
                    { id: "validation" as const, status: "completed" as const, completedAt: new Date().toISOString() },
                  ],
                }),
                ({ event }) => {
                  const result = event.output as CrossValidationResult;
                  const contradictions = result.crossValidations.filter((cv) => !cv.consistent).length;
                  deps.emitEvent({ type: "validation_complete", contradictionsFound: contradictions });
                },
                () => { deps.emitEvent({ type: "phase_change", phase: "validation", status: "completed" }); },
                ({ context }) => { deps.persistState(context); },
              ],
            },
          ],
          onError: {
            target: "failed",
            actions: [
              assign({ error: ({ event }) => String(event.error) }),
              () => { deps.emitEvent({ type: "error", message: "Cross-validation failed", recoverable: false }); },
            ],
          },
        },
      },

      // Phase 5: Synthesis & Report
      synthesis: {
        entry: [
          assign({ currentPhase: () => "synthesis" as const }),
          () => { deps.emitEvent({ type: "phase_change", phase: "synthesis", status: "started" }); },
        ],
        invoke: {
          src: "synthesizeReport",
          input: ({ context }) => ({ context, deps }),
          onDone: [
            {
              // Self-check failed and can retry — go back to retrieval for targeted re-search
              guard: ({ event, context }) => {
                const result = event.output as SynthesisResult;
                return !result.selfCheck.passed && context.selfCheckRetries < MAX_SELF_CHECK_RETRIES;
              },
              target: "retrieval",
              actions: [
                assign({
                  selfCheckRetries: ({ context }) => context.selfCheckRetries + 1,
                  targetedDimensions: ({ event }) => {
                    const result = event.output as SynthesisResult;
                    return result.selfCheck.failedChecks
                      .filter((f) => f.dimensionId)
                      .map((f) => f.dimensionId!);
                  },
                  tokenUsage: ({ context, event }) => {
                    const usage = (event.output as SynthesisResult).usage;
                    return {
                      inputTokens: context.tokenUsage.inputTokens + usage.inputTokens,
                      outputTokens: context.tokenUsage.outputTokens + usage.outputTokens,
                      totalTokens: context.tokenUsage.totalTokens + usage.totalTokens,
                      estimatedCostUSD: context.tokenUsage.estimatedCostUSD + usage.estimatedCostUSD,
                    };
                  },
                }),
                () => { deps.emitEvent({ type: "error", message: "Self-check failed, retrying with additional evidence", recoverable: true }); },
              ],
            },
            {
              // Self-check passed OR no retries left — complete
              target: "completed",
              actions: [
                assign({
                  report: ({ event }) => (event.output as SynthesisResult).report,
                  tokenUsage: ({ context, event }) => {
                    const usage = (event.output as SynthesisResult).usage;
                    return {
                      inputTokens: context.tokenUsage.inputTokens + usage.inputTokens,
                      outputTokens: context.tokenUsage.outputTokens + usage.outputTokens,
                      totalTokens: context.tokenUsage.totalTokens + usage.totalTokens,
                      estimatedCostUSD: context.tokenUsage.estimatedCostUSD + usage.estimatedCostUSD,
                    };
                  },
                  phases: ({ context }) => [
                    ...context.phases.filter((p) => p.id !== "synthesis"),
                    { id: "synthesis" as const, status: "completed" as const, completedAt: new Date().toISOString() },
                  ],
                }),
                () => { deps.emitEvent({ type: "phase_change", phase: "synthesis", status: "completed" }); },
                ({ context }) => { deps.persistState(context); },
              ],
            },
          ],
          onError: {
            target: "failed",
            actions: [
              assign({ error: ({ event }) => String(event.error) }),
              () => { deps.emitEvent({ type: "error", message: "Report synthesis failed", recoverable: false }); },
            ],
          },
        },
      },

      completed: {
        type: "final",
      },

      failed: {
        type: "final",
      },

      cancelled: {
        type: "final",
      },

      budgetExceeded: {
        type: "final",
      },
    },
  });
}

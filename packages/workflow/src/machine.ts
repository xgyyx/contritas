import { setup, assign, type AnyEventObject } from "xstate";
import type {
  ResearchContext,
  ResearchEvent,
  WorkflowDeps,
  ValidateInputResult,
} from "./types.js";
import { validateInput } from "./actors/validate-input.js";
import { decompose } from "./actors/decompose.js";
import { plan } from "./actors/plan.js";

export function createResearchMachine(deps: WorkflowDeps) {
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
    initial: "inputValidation",
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
          onDone: {
            target: "planning",
            actions: [
              assign({
                assumptions: ({ event }) => event.output.assumptions,
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
          onDone: {
            target: "retrievalPending",
            actions: [
              assign({
                dimensions: ({ event }) => event.output.dimensions,
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
              ({ context }) => { deps.persistState(context); },
            ],
          },
          onError: {
            target: "failed",
            actions: [
              assign({ error: ({ event }) => String(event.error) }),
              () => { deps.emitEvent({ type: "error", message: "Research planning failed", recoverable: false }); },
            ],
          },
        },
      },

      // Stub: Phase 3+ not yet implemented
      retrievalPending: {
        type: "final",
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
    },
  });
}

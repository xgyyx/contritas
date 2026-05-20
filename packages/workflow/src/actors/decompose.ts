import { fromPromise } from "xstate";
import {
  PHASE1_SYSTEM_PROMPT,
  phase1OutputSchema,
} from "@contritas/llm";
import type { ResearchContext, WorkflowDeps, DecomposeResult } from "../types.js";

export const decompose = fromPromise<
  DecomposeResult,
  { context: ResearchContext; deps: WorkflowDeps }
>(async ({ input: { context, deps } }) => {
  const { llmProvider, getModelForPhase } = deps;

  const proposition = context.input.validatedProposition ?? context.input.originalText;

  const { data, usage } = await llmProvider.structuredOutput({
    model: getModelForPhase("decomposition"),
    messages: [
      {
        role: "user",
        content: `Please decompose the following research proposition into its underlying assumptions:\n\n"${proposition}"`,
      },
    ],
    systemPrompt: PHASE1_SYSTEM_PROMPT,
    schema: phase1OutputSchema,
    temperature: 0,
  });

  return {
    assumptions: data.assumptions,
    usage,
  };
});

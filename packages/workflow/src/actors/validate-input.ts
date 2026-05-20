import { fromPromise } from "xstate";
import {
  PHASE0_SYSTEM_PROMPT,
  phase0OutputSchema,
} from "@contritas/llm";
import type { ResearchContext, WorkflowDeps, ValidateInputResult } from "../types.js";

export const validateInput = fromPromise<
  ValidateInputResult,
  { context: ResearchContext; deps: WorkflowDeps }
>(async ({ input: { context, deps } }) => {
  const { llmProvider, getModelForPhase } = deps;

  // Build user message from original text + any previous clarification responses
  let userMessage = context.input.originalText;
  if (context.clarificationHistory.length > 0) {
    const lastClarification =
      context.clarificationHistory[context.clarificationHistory.length - 1];
    userMessage = `Original input: ${context.input.originalText}\n\nPrevious clarification response: ${lastClarification.userResponse}`;
  }

  const { data: output } = await llmProvider.structuredOutput({
    model: getModelForPhase("inputValidation"),
    messages: [{ role: "user", content: userMessage }],
    systemPrompt: PHASE0_SYSTEM_PROMPT,
    schema: phase0OutputSchema,
    temperature: 0,
  });

  return {
    valid: output.valid,
    output,
  };
});

import { fromPromise } from "xstate";
import {
  PHASE0_SYSTEM_PROMPT,
  phase0OutputSchema,
} from "@contritas/llm";
import {
  wrapExternalContent,
  EXTERNAL_CONTENT_SAFETY_CLAUSE,
} from "@contritas/shared";
import type { ResearchContext, WorkflowDeps, ValidateInputResult } from "../types.js";

export const validateInput = fromPromise<
  ValidateInputResult,
  { context: ResearchContext; deps: WorkflowDeps }
>(async ({ input: { context, deps } }) => {
  const { llmProvider, getModelForPhase } = deps;

  // Build user message from original text + any previous clarification responses.
  // Both the proposition and any clarification are untrusted user input — wrap in sentinels.
  const parts: string[] = [
    "Original proposition (user-provided):",
    wrapExternalContent(context.input.originalText, { kind: "user-proposition" }),
  ];
  if (context.clarificationHistory.length > 0) {
    const lastClarification =
      context.clarificationHistory[context.clarificationHistory.length - 1];
    parts.push(
      "",
      "Previous clarification response (user-provided):",
      wrapExternalContent(lastClarification.userResponse, { kind: "user-clarification" })
    );
  }
  const userMessage = parts.join("\n");

  const { data: output, usage } = await llmProvider.structuredOutput({
    model: getModelForPhase("inputValidation"),
    messages: [{ role: "user", content: userMessage }],
    systemPrompt: PHASE0_SYSTEM_PROMPT + EXTERNAL_CONTENT_SAFETY_CLAUSE,
    schema: phase0OutputSchema,
    temperature: 0,
  });

  return {
    valid: output.valid,
    output,
    usage,
  };
});

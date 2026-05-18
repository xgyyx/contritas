import { fromPromise } from "xstate";
import {
  PHASE2_SYSTEM_PROMPT,
  phase2OutputSchema,
} from "@contritas/llm";
import type { ResearchContext, WorkflowDeps, PlanResult } from "../types.js";

export const plan = fromPromise<
  PlanResult,
  { context: ResearchContext; deps: WorkflowDeps }
>(async ({ input: { context, deps } }) => {
  const { llmProvider, llmModel } = deps;

  const proposition = context.input.validatedProposition ?? context.input.originalText;
  const assumptionsList = context.assumptions
    .map((a, i) => `${i + 1}. [${a.type}, ${a.importance}] ${a.content}`)
    .join("\n");

  const { data, usage } = await llmProvider.structuredOutput({
    model: llmModel,
    messages: [
      {
        role: "user",
        content: `Research proposition: "${proposition}"\n\nDecomposed assumptions:\n${assumptionsList}\n\nPlease create a multi-dimensional research plan.`,
      },
    ],
    systemPrompt: PHASE2_SYSTEM_PROMPT,
    schema: phase2OutputSchema,
    temperature: 0,
  });

  return {
    dimensions: data.dimensions,
    complexity: data.complexity,
    estimatedMinutes: data.estimatedMinutes,
    usage,
  };
});

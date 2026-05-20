import { fromPromise } from "xstate";
import {
  PHASE4_SYSTEM_PROMPT,
  phase4OutputSchema,
} from "@contritas/llm";
import type { ResearchContext, WorkflowDeps, CrossValidationResult, EvidenceData } from "../types.js";

export const crossValidate = fromPromise<
  CrossValidationResult,
  { context: ResearchContext; deps: WorkflowDeps }
>(async ({ input: { context, deps } }) => {
  const { llmProvider, getModelForPhase } = deps;

  // Group evidence by dimensionId
  const evidenceByDimension = new Map<string, EvidenceData[]>();
  for (const ev of context.evidence) {
    const list = evidenceByDimension.get(ev.dimensionId) ?? [];
    list.push(ev);
    evidenceByDimension.set(ev.dimensionId, list);
  }

  // Build user message with evidence grouped by dimension and relationship
  const dimensionSections: string[] = [];

  for (const [dimId, evidenceList] of evidenceByDimension) {
    const supports = evidenceList.filter((e) => e.relationship === "supports");
    const weakens = evidenceList.filter((e) => e.relationship === "weakens");
    const qualifies = evidenceList.filter((e) => e.relationship === "qualifies");

    const formatEvidence = (items: EvidenceData[]) =>
      items
        .map(
          (e, i) =>
            `  [${i + 1}] id=${e.id} "${e.sourceName}" (credibility: ${e.credibility}, date: ${e.publishedDate ?? "unknown"})` +
            `\n      Excerpt: ${e.keyExcerpt}` +
            `\n      URL: ${e.url}`
        )
        .join("\n");

    dimensionSections.push(
      `### Dimension: ${dimId}\n` +
        `Evidence count: ${evidenceList.length}\n\n` +
        `**Supports (${supports.length}):**\n${supports.length > 0 ? formatEvidence(supports) : "  (none)"}\n\n` +
        `**Weakens (${weakens.length}):**\n${weakens.length > 0 ? formatEvidence(weakens) : "  (none)"}\n\n` +
        `**Qualifies (${qualifies.length}):**\n${qualifies.length > 0 ? formatEvidence(qualifies) : "  (none)"}`
    );
  }

  const userMessage = `Please cross-validate the evidence collected for the following research proposition:

"${context.input.validatedProposition ?? context.input.originalText}"

## Evidence by Dimension

${dimensionSections.join("\n\n---\n\n")}

For each dimension, analyze consistency and assign a verdict. Return the dimensionId exactly as shown above.`;

  const { data, usage } = await llmProvider.structuredOutput({
    model: getModelForPhase("validation"),
    messages: [{ role: "user", content: userMessage }],
    systemPrompt: PHASE4_SYSTEM_PROMPT,
    schema: phase4OutputSchema,
    temperature: 0,
  });

  // Map LLM output to CrossValidationData. Use only real evidence ids: filter out anything the LLM
  // hallucinated, and fall back to the full set of real ids when the LLM returns nothing.
  // (id is assigned later in the validation onDone action of the state machine.)
  const crossValidations = data.validations.map((v) => {
    const dimEvidence = evidenceByDimension.get(v.dimensionId) ?? [];
    const realIds = new Set(dimEvidence.map((e) => e.id));
    const filteredIds = v.evidenceIds.filter((id) => realIds.has(id));
    const evidenceIds = filteredIds.length > 0 ? filteredIds : dimEvidence.map((e) => e.id);
    return {
      dimensionId: v.dimensionId,
      evidenceIds,
      consistent: v.consistent,
      contradictionDescription: v.contradictionDescription,
      contradictionReason: v.contradictionReason,
      verdict: v.verdict,
      confidence: v.confidence,
    };
  });

  return { crossValidations, usage };
});

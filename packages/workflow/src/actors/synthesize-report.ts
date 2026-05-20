import { fromPromise } from "xstate";
import {
  PHASE5_SYSTEM_PROMPT,
  phase5OutputSchema,
} from "@contritas/llm";
import { REPORT_CHAR_TARGETS } from "@contritas/shared";
import type {
  ResearchContext,
  WorkflowDeps,
  SynthesisResult,
  CrossValidationData,
  EvidenceData,
} from "../types.js";
import { runSelfChecks } from "../utils/self-check.js";

export const synthesizeReport = fromPromise<
  SynthesisResult,
  { context: ResearchContext; deps: WorkflowDeps }
>(async ({ input: { context, deps } }) => {
  const { llmProvider, getModelForPhase } = deps;

  const proposition = context.input.validatedProposition ?? context.input.originalText;
  const complexity = context.complexity ?? "medium";
  const charTarget = REPORT_CHAR_TARGETS[complexity];

  // Build assumptions section
  const assumptionsText = context.assumptions
    .map(
      (a, i) =>
        `${i + 1}. [${a.type}] (重要性: ${a.importance}) ${a.content}`
    )
    .join("\n");

  // Build dimensions section with cross-validation results
  const cvMap = new Map<string, CrossValidationData>();
  for (const cv of context.crossValidations) {
    cvMap.set(cv.dimensionId, cv);
  }

  // Group evidence by dimension
  const evidenceByDimension = new Map<string, EvidenceData[]>();
  for (const ev of context.evidence) {
    const list = evidenceByDimension.get(ev.dimensionId) ?? [];
    list.push(ev);
    evidenceByDimension.set(ev.dimensionId, list);
  }

  const dimensionsText = Array.from(evidenceByDimension.entries())
    .map(([dimId, evidenceList]) => {
      const cv = cvMap.get(dimId);
      const verdictStr = cv
        ? `Verdict: ${cv.verdict}, Confidence: ${cv.confidence}, Consistent: ${cv.consistent}`
        : "Verdict: pending";
      const contradictionStr =
        cv && !cv.consistent
          ? `\nContradiction: ${cv.contradictionDescription} (reason: ${cv.contradictionReason})`
          : "";

      const evidenceStr = evidenceList
        .map(
          (e, i) =>
            `  [${i + 1}] "${e.sourceName}" (${e.sourceType}, credibility: ${e.credibility}, relationship: ${e.relationship})` +
            `\n      Excerpt: ${e.keyExcerpt}` +
            `\n      URL: ${e.url}` +
            (e.publishedDate ? `\n      Date: ${e.publishedDate}` : "") +
            (e.timelinessRisk ? `\n      ⚠️ Timeliness risk` : "")
        )
        .join("\n");

      // Find dimension name from context.dimensions by matching position with evidenceByDimension order
      const dimIndex = Array.from(evidenceByDimension.keys()).indexOf(dimId);
      const dimData = context.dimensions[dimIndex];
      const dimName = dimData?.name ?? dimId;
      const coreQuestion = dimData?.coreQuestion ?? "";
      const counterQuestion = dimData?.counterQuestion ?? "";

      return (
        `### Dimension: ${dimName} (ID: ${dimId})\n` +
        `Core Question: ${coreQuestion}\n` +
        `Counter Question: ${counterQuestion}\n` +
        `${verdictStr}${contradictionStr}\n\n` +
        `Evidence (${evidenceList.length} items):\n${evidenceStr}`
      );
    })
    .join("\n\n---\n\n");

  const userMessage = `Generate a comprehensive research report for the following proposition:

"${proposition}"

## Input Language
${context.input.language === "zh" ? "Chinese (中文)" : "English"}
(Write the report in the same language as the input)

## Complexity Level: ${complexity}
Target report length: ${charTarget.min}-${charTarget.max} characters (core content)

## Assumptions (${context.assumptions.length} total)
${assumptionsText}

## Dimensions with Cross-Validation Results
${dimensionsText}

## Evidence Summary
- Total evidence items: ${context.evidence.length}
- High credibility: ${context.evidence.filter((e) => e.credibility === "high").length}
- Medium credibility: ${context.evidence.filter((e) => e.credibility === "medium").length}
- Low credibility: ${context.evidence.filter((e) => e.credibility === "low").length}

Generate the full 8-section report following the template exactly.`;

  const { data, usage } = await llmProvider.structuredOutput({
    model: getModelForPhase("synthesis"),
    messages: [{ role: "user", content: userMessage }],
    systemPrompt: PHASE5_SYSTEM_PROMPT,
    schema: phase5OutputSchema,
    temperature: 0.1,
    maxTokens: 16384,
  });

  // Compute metrics
  const charCount = data.markdownContent.length;
  const sourceCount = context.evidence.length;

  // Run self-checks
  const selfCheck = runSelfChecks(data.markdownContent, context);

  return {
    report: {
      markdownContent: data.markdownContent,
      overallScore: data.overallScore,
      overallVerdict: data.overallVerdict,
      charCount,
      sourceCount,
    },
    selfCheck,
    usage,
  };
});

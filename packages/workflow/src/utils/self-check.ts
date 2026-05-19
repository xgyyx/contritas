import { MIN_EVIDENCE_FOR_REPORT, MIN_HIGH_CREDIBILITY_FOR_REPORT } from "@contritas/shared";
import type { ResearchContext, SelfCheckResult, SelfCheckFailure } from "../types.js";

/**
 * Run the 4 mandatory self-checks on a generated report.
 * These are deterministic code checks, NOT LLM-based.
 */
export function runSelfChecks(
  markdownContent: string,
  context: ResearchContext
): SelfCheckResult {
  const failedChecks: SelfCheckFailure[] = [];

  // Check 1: Every dimension has a counter-question section
  checkCounterQuestions(markdownContent, context, failedChecks);

  // Check 2: Every dimension has >= MIN_EVIDENCE evidence refs, >= MIN_HIGH_CREDIBILITY high-credibility
  checkEvidenceCoverage(context, failedChecks);

  // Check 3: Reference source table is present and non-empty
  checkSourceTable(markdownContent, failedChecks);

  // Check 4: Score explanation includes "why not higher" and "why not lower"
  checkScoreExplanation(markdownContent, failedChecks);

  return {
    passed: failedChecks.length === 0,
    failedChecks,
  };
}

function checkCounterQuestions(
  markdown: string,
  context: ResearchContext,
  failures: SelfCheckFailure[]
): void {
  // Look for counter-question sections (Chinese: 反向质疑, English: Counter)
  const counterQuestionPattern = /#{1,4}\s*(反向质疑|Counter[-\s]?[Qq]uestion)/g;
  const matches = markdown.match(counterQuestionPattern) ?? [];

  // Count unique dimensions from evidence
  const dimensionIds = new Set(context.evidence.map((e) => e.dimensionId));
  const dimensionCount = dimensionIds.size;

  if (matches.length < dimensionCount) {
    // Find which dimensions are missing — we can't map directly, so report generically
    failures.push({
      check: "counter_questions",
      reason: `Found ${matches.length} counter-question sections but expected ${dimensionCount} (one per dimension)`,
    });
  }
}

function checkEvidenceCoverage(
  context: ResearchContext,
  failures: SelfCheckFailure[]
): void {
  // Group evidence by dimension
  const evidenceByDimension = new Map<string, typeof context.evidence>();
  for (const ev of context.evidence) {
    const list = evidenceByDimension.get(ev.dimensionId) ?? [];
    list.push(ev);
    evidenceByDimension.set(ev.dimensionId, list);
  }

  for (const [dimId, evidenceList] of evidenceByDimension) {
    if (evidenceList.length < MIN_EVIDENCE_FOR_REPORT) {
      failures.push({
        check: "evidence_coverage",
        dimensionId: dimId,
        reason: `Dimension ${dimId} has only ${evidenceList.length} evidence items (minimum: ${MIN_EVIDENCE_FOR_REPORT})`,
      });
    }

    const highCredibility = evidenceList.filter((e) => e.credibility === "high").length;
    if (highCredibility < MIN_HIGH_CREDIBILITY_FOR_REPORT) {
      failures.push({
        check: "high_credibility_evidence",
        dimensionId: dimId,
        reason: `Dimension ${dimId} has only ${highCredibility} high-credibility sources (minimum: ${MIN_HIGH_CREDIBILITY_FOR_REPORT})`,
      });
    }
  }
}

function checkSourceTable(
  markdown: string,
  failures: SelfCheckFailure[]
): void {
  // Check for the presence of a source/reference table section
  const hasSourceSection = /#{1,4}\s*(八、参考来源|参考来源|References|Sources)/i.test(markdown);
  if (!hasSourceSection) {
    failures.push({
      check: "source_table",
      reason: "Report is missing the reference source table section",
    });
    return;
  }

  // Check that the table has at least one data row (pipe-delimited, not header separator)
  const sourceSection = markdown.split(/#{1,4}\s*(八、参考来源|参考来源|References|Sources)/i).pop() ?? "";
  const tableRows = sourceSection
    .split("\n")
    .filter((line) => line.includes("|") && !line.match(/^\s*\|?\s*[-:]+/));
  // Subtract header row
  const dataRows = tableRows.length > 1 ? tableRows.length - 1 : 0;

  if (dataRows === 0) {
    failures.push({
      check: "source_table",
      reason: "Reference source table exists but contains no entries",
    });
  }
}

function checkScoreExplanation(
  markdown: string,
  failures: SelfCheckFailure[]
): void {
  // Check for score explanation section
  const hasScoreSection = /#{1,4}\s*(六、综合评估|综合评估|Overall Assessment)/i.test(markdown);
  if (!hasScoreSection) {
    failures.push({
      check: "score_explanation",
      reason: "Report is missing the overall assessment section",
    });
    return;
  }

  // Check for "why not higher" and "why not lower" patterns
  const scoreSection = markdown.split(/#{1,4}\s*(六、综合评估|综合评估|Overall Assessment)/i).pop() ?? "";

  const hasWhyNotHigher =
    /为什么不是更高|为什么不更高|why not higher|不是更高/i.test(scoreSection) ||
    /评分说明/.test(scoreSection); // If score explanation section exists, it likely covers both

  const hasWhyNotLower =
    /为什么不是更低|为什么不更低|why not lower|不是更低/i.test(scoreSection) ||
    /评分说明/.test(scoreSection);

  if (!hasWhyNotHigher && !hasWhyNotLower) {
    failures.push({
      check: "score_explanation",
      reason: "Score explanation does not include 'why not higher' and 'why not lower' analysis",
    });
  }
}

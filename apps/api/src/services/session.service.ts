import { eq, sql, desc } from "drizzle-orm";
import { db, schema } from "../drizzle/index.js";
import type { SessionStatus } from "@contritas/shared";

export interface CreateSessionParams {
  id: string;
  input: {
    originalText: string;
    language: "zh" | "en";
  };
  config: {
    llmProvider: string;
    llmModel: string;
    searchProvider?: string;
  };
}

export async function createSession(params: CreateSessionParams) {
  const [session] = await db
    .insert(schema.researchSessions)
    .values({
      id: params.id,
      status: "in_progress",
      input: params.input,
      config: params.config,
      phases: [],
      tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCostUSD: 0 },
    })
    .returning();

  return session;
}

export async function getSession(id: string) {
  const [session] = await db
    .select()
    .from(schema.researchSessions)
    .where(eq(schema.researchSessions.id, id));

  return session ?? null;
}

export async function getSessionWithCounts(id: string) {
  const session = await getSession(id);
  if (!session) return null;

  const [assumptionCount] = await db
    .select({ count: sql<number>`count(*)` })
    .from(schema.assumptions)
    .where(eq(schema.assumptions.sessionId, id));

  const [dimensionCount] = await db
    .select({ count: sql<number>`count(*)` })
    .from(schema.dimensions)
    .where(eq(schema.dimensions.sessionId, id));

  const [evidenceCount] = await db
    .select({ count: sql<number>`count(*)` })
    .from(schema.evidence)
    .where(eq(schema.evidence.sessionId, id));

  return {
    ...session,
    assumptionCount: Number(assumptionCount?.count ?? 0),
    dimensionCount: Number(dimensionCount?.count ?? 0),
    evidenceCount: Number(evidenceCount?.count ?? 0),
  };
}

export async function updateSessionStatus(id: string, status: SessionStatus) {
  await db
    .update(schema.researchSessions)
    .set({
      status,
      updatedAt: new Date(),
      ...(status === "completed" || status === "failed" || status === "cancelled"
        ? { completedAt: new Date() }
        : {}),
    })
    .where(eq(schema.researchSessions.id, id));
}

export async function updateSessionPhases(id: string, phases: unknown[]) {
  await db
    .update(schema.researchSessions)
    .set({ phases, updatedAt: new Date() })
    .where(eq(schema.researchSessions.id, id));
}

export async function updateSearchCallsUsed(id: string, searchCallsUsed: number) {
  await db
    .update(schema.researchSessions)
    .set({ searchCallsUsed, updatedAt: new Date() })
    .where(eq(schema.researchSessions.id, id));
}

export async function getReport(sessionId: string) {
  const [report] = await db
    .select()
    .from(schema.reports)
    .where(eq(schema.reports.sessionId, sessionId))
    .orderBy(desc(schema.reports.version))
    .limit(1);

  return report ?? null;
}

export async function getEvidence(sessionId: string) {
  return db
    .select()
    .from(schema.evidence)
    .where(eq(schema.evidence.sessionId, sessionId));
}

export async function getCrossValidations(sessionId: string) {
  return db
    .select()
    .from(schema.crossValidations)
    .where(eq(schema.crossValidations.sessionId, sessionId));
}

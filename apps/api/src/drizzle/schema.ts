import {
  pgTable,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  index,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// ══════════════════════════════════════════
// Research Sessions
// ══════════════════════════════════════════
export const researchSessions = pgTable(
  "research_sessions",
  {
    id: text("id").primaryKey(),
    status: text("status").notNull(), // awaiting_input | in_progress | completed | failed | cancelled
    input: jsonb("input").notNull(), // { originalText, validatedProposition, language }
    complexity: text("complexity"), // low | medium | high
    config: jsonb("config").notNull(), // { llmProvider, llmModel, searchProvider }
    phases: jsonb("phases").notNull().default([]),
    tokenUsage: jsonb("token_usage").notNull().default({}),
    searchCallsUsed: integer("search_calls_used").default(0),
    parentSessionId: text("parent_session_id"),
    ownerTokenHash: text("owner_token_hash"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    index("idx_sessions_status").on(table.status),
    index("idx_sessions_created").on(table.createdAt),
    index("idx_sessions_owner").on(table.ownerTokenHash),
    index("idx_sessions_parent").on(table.parentSessionId),
  ]
);

// ══════════════════════════════════════════
// Assumptions
// ══════════════════════════════════════════
export const assumptions = pgTable(
  "assumptions",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => researchSessions.id),
    content: text("content").notNull(),
    type: text("type").notNull(), // factual | judgmental
    importance: text("importance").notNull(), // high | medium | low
    order: integer("order").notNull(),
    verdict: text("verdict"), // supported | disputed | unsupported
    evidenceStrength: text("evidence_strength"), // strong | medium | weak
  },
  (table) => [
    index("idx_assumptions_session").on(table.sessionId),
    uniqueIndex("uq_assumptions_session_order").on(table.sessionId, table.order),
  ]
);

// ══════════════════════════════════════════
// Dimensions
// ══════════════════════════════════════════
export const dimensions = pgTable(
  "dimensions",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => researchSessions.id),
    name: text("name").notNull(),
    coreQuestion: text("core_question").notNull(),
    counterQuestion: text("counter_question").notNull(),
    assumptionIds: text("assumption_ids").array().notNull(),
    keywords: jsonb("keywords").notNull(), // { zh: string[], en: string[] }
    status: text("status").notNull().default("pending"), // pending | searching | completed | insufficient
    currentRound: integer("current_round").default(0),
    maxRounds: integer("max_rounds").default(5),
    sourcesFound: integer("sources_found").default(0),
    highCredibilitySources: integer("high_credibility_sources").default(0),
    verdict: text("verdict"), // supported | disputed | unsupported
    confidence: text("confidence"), // high | medium | low
    weight: text("weight"), // high | medium | low
  },
  (table) => [
    index("idx_dimensions_session").on(table.sessionId),
    uniqueIndex("uq_dimensions_session_name").on(table.sessionId, table.name),
  ]
);

// ══════════════════════════════════════════
// Evidence
// ══════════════════════════════════════════
export const evidence = pgTable(
  "evidence",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => researchSessions.id),
    dimensionId: text("dimension_id")
      .notNull()
      .references(() => dimensions.id),
    searchQuery: text("search_query").notNull(),
    searchRound: integer("search_round").notNull(),
    url: text("url").notNull(),
    title: text("title"),
    sourceName: text("source_name"),
    sourceType: text("source_type").notNull(), // official_doc | statistics | academic | industry_report | case_study | community | media
    credibility: text("credibility").notNull(), // high | medium | low
    publishedDate: text("published_date"),
    language: text("language").notNull(), // zh | en
    keyExcerpt: text("key_excerpt").notNull(),
    relationship: text("relationship").notNull(), // supports | weakens | qualifies
    timelinessRisk: boolean("timeliness_risk").default(false),
    retrievedAt: timestamp("retrieved_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_evidence_session").on(table.sessionId),
    index("idx_evidence_dimension").on(table.dimensionId),
  ]
);

// ══════════════════════════════════════════
// Cross Validations
// ══════════════════════════════════════════
export const crossValidations = pgTable(
  "cross_validations",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => researchSessions.id),
    dimensionId: text("dimension_id")
      .notNull()
      .references(() => dimensions.id),
    evidenceIds: text("evidence_ids").array().notNull(),
    consistent: boolean("consistent").notNull(),
    contradictionDescription: text("contradiction_description"),
    contradictionReason: text("contradiction_reason"), // source_bias | time_difference | scope_mismatch | methodology_difference
  },
  (table) => [
    index("idx_cross_validations_session").on(table.sessionId),
    index("idx_cross_validations_dimension").on(table.dimensionId),
  ]
);

// ══════════════════════════════════════════
// Reports
// ══════════════════════════════════════════
export const reports = pgTable(
  "reports",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => researchSessions.id),
    version: integer("version").notNull().default(1),
    markdownContent: text("markdown_content").notNull(),
    overallScore: text("overall_score"), // e.g. "5.5-6.0"
    overallVerdict: text("overall_verdict"), // proceed | proceed_with_caution | hold | abandon
    charCount: integer("char_count"),
    sourceCount: integer("source_count"),
    generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_reports_session").on(table.sessionId),
    unique("uq_reports_session_version").on(table.sessionId, table.version),
  ]
);

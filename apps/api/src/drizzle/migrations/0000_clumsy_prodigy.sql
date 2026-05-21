CREATE TABLE IF NOT EXISTS "assumptions" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"content" text NOT NULL,
	"type" text NOT NULL,
	"importance" text NOT NULL,
	"order" integer NOT NULL,
	"verdict" text,
	"evidence_strength" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cross_validations" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"dimension_id" text NOT NULL,
	"evidence_ids" text[] NOT NULL,
	"consistent" boolean NOT NULL,
	"contradiction_description" text,
	"contradiction_reason" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "dimensions" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"name" text NOT NULL,
	"core_question" text NOT NULL,
	"counter_question" text NOT NULL,
	"assumption_ids" text[] NOT NULL,
	"keywords" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"current_round" integer DEFAULT 0,
	"max_rounds" integer DEFAULT 5,
	"sources_found" integer DEFAULT 0,
	"high_credibility_sources" integer DEFAULT 0,
	"verdict" text,
	"confidence" text,
	"weight" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "evidence" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"dimension_id" text NOT NULL,
	"search_query" text NOT NULL,
	"search_round" integer NOT NULL,
	"url" text NOT NULL,
	"title" text,
	"source_name" text,
	"source_type" text NOT NULL,
	"credibility" text NOT NULL,
	"published_date" text,
	"language" text NOT NULL,
	"key_excerpt" text NOT NULL,
	"relationship" text NOT NULL,
	"timeliness_risk" boolean DEFAULT false,
	"retrieved_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "reports" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"markdown_content" text NOT NULL,
	"overall_score" text,
	"overall_verdict" text,
	"char_count" integer,
	"source_count" integer,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_reports_session_version" UNIQUE("session_id","version")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "research_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"status" text NOT NULL,
	"input" jsonb NOT NULL,
	"complexity" text,
	"config" jsonb NOT NULL,
	"phases" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"token_usage" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"search_calls_used" integer DEFAULT 0,
	"parent_session_id" text,
	"owner_token_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "assumptions" ADD CONSTRAINT "assumptions_session_id_research_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."research_sessions"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cross_validations" ADD CONSTRAINT "cross_validations_session_id_research_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."research_sessions"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cross_validations" ADD CONSTRAINT "cross_validations_dimension_id_dimensions_id_fk" FOREIGN KEY ("dimension_id") REFERENCES "public"."dimensions"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "dimensions" ADD CONSTRAINT "dimensions_session_id_research_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."research_sessions"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "evidence" ADD CONSTRAINT "evidence_session_id_research_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."research_sessions"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "evidence" ADD CONSTRAINT "evidence_dimension_id_dimensions_id_fk" FOREIGN KEY ("dimension_id") REFERENCES "public"."dimensions"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reports" ADD CONSTRAINT "reports_session_id_research_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."research_sessions"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_assumptions_session" ON "assumptions" USING btree ("session_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_assumptions_session_order" ON "assumptions" USING btree ("session_id","order");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_cross_validations_session" ON "cross_validations" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_cross_validations_dimension" ON "cross_validations" USING btree ("dimension_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_dimensions_session" ON "dimensions" USING btree ("session_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_dimensions_session_name" ON "dimensions" USING btree ("session_id","name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_evidence_session" ON "evidence" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_evidence_dimension" ON "evidence" USING btree ("dimension_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_reports_session" ON "reports" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_sessions_status" ON "research_sessions" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_sessions_created" ON "research_sessions" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_sessions_owner" ON "research_sessions" USING btree ("owner_token_hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_sessions_parent" ON "research_sessions" USING btree ("parent_session_id");
-- Discovery operational health and immutable candidate identity-change events.
-- Neither table authorizes ingestion or publication.
CREATE TABLE "discovery_seed_health" (
  "seed_key" text PRIMARY KEY NOT NULL,
  "hostname" text NOT NULL,
  "status" text DEFAULT 'unknown' NOT NULL,
  "success_count" integer DEFAULT 0 NOT NULL,
  "failure_count" integer DEFAULT 0 NOT NULL,
  "consecutive_failures" integer DEFAULT 0 NOT NULL,
  "candidates_last_run" integer DEFAULT 0 NOT NULL,
  "last_run_at" timestamp with time zone,
  "last_success_at" timestamp with time zone,
  "last_failure_at" timestamp with time zone,
  "last_error" text,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "discovery_candidate_changes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "candidate_id" uuid NOT NULL REFERENCES "discovery_candidates"("id") ON DELETE CASCADE,
  "run_id" uuid NOT NULL REFERENCES "discovery_runs"("id") ON DELETE CASCADE,
  "change_type" text NOT NULL,
  "prior_provider" text,
  "provider" text,
  "prior_board_token" text,
  "board_token" text,
  "observed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "discovery_changes_recent_idx" ON "discovery_candidate_changes" ("observed_at");
--> statement-breakpoint
CREATE INDEX "discovery_changes_candidate_idx" ON "discovery_candidate_changes" ("candidate_id","observed_at");

-- Operator-only scheduled provider discovery. Never bypasses job_source approval.
CREATE TABLE "external_discovery_leads" (
  "lead_key" text PRIMARY KEY NOT NULL,
  "provider" text NOT NULL,
  "title" text NOT NULL,
  "company" text NOT NULL,
  "location" text NOT NULL,
  "url" text NOT NULL,
  "search_query" text NOT NULL,
  "content_fingerprint" text NOT NULL,
  "state" text DEFAULT 'pending' NOT NULL,
  "first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
  "reviewed_at" timestamp with time zone,
  "reviewed_by" text REFERENCES "users"("id") ON DELETE SET NULL,
  "review_note" text,
  CONSTRAINT "external_discovery_leads_state_check" CHECK ("state" IN ('pending','reviewed','rejected'))
);
--> statement-breakpoint
CREATE INDEX "external_discovery_review_idx" ON "external_discovery_leads"("state","last_seen_at");
--> statement-breakpoint
CREATE TABLE "external_discovery_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "status" text DEFAULT 'running' NOT NULL,
  "queries" integer DEFAULT 0 NOT NULL,
  "found" integer DEFAULT 0 NOT NULL,
  "updated" integer DEFAULT 0 NOT NULL,
  "failures" integer DEFAULT 0 NOT NULL,
  "error" text,
  "started_at" timestamp with time zone DEFAULT now() NOT NULL,
  "finished_at" timestamp with time zone
);

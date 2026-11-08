ALTER TABLE "candidate_preferences" ADD COLUMN "personalization_enabled" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
CREATE TABLE "external_saved_leads" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "provider" text NOT NULL,
  "lead_key" text NOT NULL,
  "title" text NOT NULL,
  "company" text NOT NULL,
  "location" text NOT NULL,
  "url" text NOT NULL,
  "status" text DEFAULT 'saved' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "external_leads_status_check" CHECK ("status" IN ('saved','applied','interviewing','offer','rejected','closed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "external_leads_owner_identity_idx" ON "external_saved_leads"("user_id","provider","lead_key");
--> statement-breakpoint
CREATE INDEX "external_leads_owner_recent_idx" ON "external_saved_leads"("user_id","created_at");

CREATE TABLE "ingestion_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"kind" text DEFAULT 'sync' NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"payload" jsonb,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_token" uuid,
	"lease_until" timestamp with time zone,
	"cancel_requested" boolean DEFAULT false NOT NULL,
	"last_error" text,
	"error_code" text,
	"result" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "source_host_budgets" (
	"hostname" text PRIMARY KEY NOT NULL,
	"next_request_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ingestion_errors" ADD COLUMN "raw_payload" jsonb;--> statement-breakpoint
ALTER TABLE "ingestion_errors" ADD COLUMN "disposition" text DEFAULT 'quarantined' NOT NULL;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "source_owner_id" uuid;--> statement-breakpoint
ALTER TABLE "source_job_mappings" ADD COLUMN "normalized_payload" jsonb;--> statement-breakpoint
ALTER TABLE "source_job_mappings" ADD COLUMN "source_posted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "source_job_mappings" ADD COLUMN "first_missing_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "job_sources" ADD COLUMN "approval_status" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "job_sources" ADD COLUMN "approved_by" text;--> statement-breakpoint
ALTER TABLE "job_sources" ADD COLUMN "approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "job_sources" ADD COLUMN "authorization_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "job_sources" ADD COLUMN "endpoint_url" text;--> statement-breakpoint
ALTER TABLE "job_sources" ADD COLUMN "approved_hostname" text;--> statement-breakpoint
ALTER TABLE "job_sources" ADD COLUMN "application_hostnames" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "job_sources" ADD COLUMN "usage_conditions" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "job_sources" ADD COLUMN "config" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "job_sources" ADD COLUMN "revision" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "job_sources" ADD COLUMN "validated_revision" integer;--> statement-breakpoint
ALTER TABLE "job_sources" ADD COLUMN "last_test_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "job_sources" ADD COLUMN "missing_confirmations" integer DEFAULT 2 NOT NULL;--> statement-breakpoint
ALTER TABLE "job_sources" ADD COLUMN "missing_grace_minutes" integer DEFAULT 60 NOT NULL;--> statement-breakpoint
ALTER TABLE "job_sources" ADD COLUMN "next_sync_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "job_sources" ADD COLUMN "last_failure_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "job_sources" ADD COLUMN "consecutive_failures" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "job_sources" ADD COLUMN "health" text DEFAULT 'unconfigured' NOT NULL;--> statement-breakpoint
ALTER TABLE "job_sources" ADD COLUMN "sync_lease_token" uuid;--> statement-breakpoint
ALTER TABLE "job_sources" ADD COLUMN "sync_lease_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "source_sync_runs" ADD COLUMN "task_id" uuid;--> statement-breakpoint
ALTER TABLE "source_sync_runs" ADD COLUMN "revision" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "source_sync_runs" ADD COLUMN "imported" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "source_sync_runs" ADD COLUMN "updated" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "source_sync_runs" ADD COLUMN "closed" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "source_sync_runs" ADD COLUMN "duplicates" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "source_sync_runs" ADD COLUMN "quarantined" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "source_sync_runs" ADD COLUMN "protected" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "source_sync_runs" ADD COLUMN "requests" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "source_sync_runs" ADD COLUMN "duration_ms" integer;--> statement-breakpoint
ALTER TABLE "source_sync_runs" ADD COLUMN "complete" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "ingestion_tasks" ADD CONSTRAINT "ingestion_tasks_source_id_job_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."job_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ingestion_tasks_due_idx" ON "ingestion_tasks" USING btree ("status","available_at");--> statement-breakpoint
CREATE INDEX "ingestion_tasks_source_idx" ON "ingestion_tasks" USING btree ("source_id","created_at");--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_source_owner_id_job_sources_id_fk" FOREIGN KEY ("source_owner_id") REFERENCES "public"."job_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_sources" ADD CONSTRAINT "job_sources_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_sync_runs" ADD CONSTRAINT "source_sync_runs_task_id_ingestion_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."ingestion_tasks"("id") ON DELETE no action ON UPDATE no action;
CREATE TABLE "candidate_preferences" (
	"user_id" text PRIMARY KEY NOT NULL,
	"email_alerts_enabled" boolean DEFAULT true NOT NULL,
	"search_history_enabled" boolean DEFAULT false NOT NULL,
	"history_consented_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "search_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"fingerprint" text NOT NULL,
	"filters" jsonb NOT NULL,
	"last_used_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "candidate_preferences" ADD CONSTRAINT "candidate_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "search_history" ADD CONSTRAINT "search_history_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "search_history_user_fingerprint_idx" ON "search_history" USING btree ("user_id","fingerprint");--> statement-breakpoint
CREATE INDEX "search_history_user_date_idx" ON "search_history" USING btree ("user_id","last_used_at");
--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD COLUMN "first_attempt_at" timestamp with time zone;
--> statement-breakpoint
CREATE INDEX "search_history_date_idx" ON "search_history" USING btree ("last_used_at");

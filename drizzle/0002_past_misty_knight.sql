CREATE TABLE "development_emails" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recipient" text NOT NULL,
	"subject" text NOT NULL,
	"html" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "development_emails_dedupe_key_unique" UNIQUE("dedupe_key")
);

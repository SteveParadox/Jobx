CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE FUNCTION array_to_string_immutable(text[]) RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$ SELECT array_to_string($1, ' ') $$;
--> statement-breakpoint
ALTER TABLE jobs ADD COLUMN search_vector tsvector GENERATED ALWAYS AS (
 setweight(to_tsvector('english', coalesce(title,'')), 'A') ||
 setweight(to_tsvector('english', coalesce(array_to_string_immutable(skills),'') ), 'B') ||
 setweight(to_tsvector('english', coalesce(description_text,'')), 'C')
) STORED;
--> statement-breakpoint
CREATE INDEX jobs_search_vector_idx ON jobs USING gin(search_vector);
--> statement-breakpoint
CREATE INDEX jobs_title_trgm_idx ON jobs USING gin(title gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX jobs_remote_countries_idx ON jobs USING gin(remote_countries);
--> statement-breakpoint
CREATE INDEX jobs_skills_idx ON jobs USING gin(skills);
--> statement-breakpoint
CREATE INDEX source_runs_source_date_idx ON source_sync_runs(source_id, started_at DESC);
--> statement-breakpoint
CREATE INDEX deliveries_pending_idx ON notification_deliveries(status, created_at);
--> statement-breakpoint
CREATE INDEX alerts_user_idx ON job_alerts(user_id);
--> statement-breakpoint
CREATE INDEX applications_job_idx ON applications(job_id, created_at DESC);
--> statement-breakpoint
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('candidate','admin'));
--> statement-breakpoint
ALTER TABLE employer_memberships ADD CONSTRAINT membership_role_check CHECK (role IN ('owner','admin','recruiter','viewer'));
--> statement-breakpoint
ALTER TABLE jobs ADD CONSTRAINT job_status_check CHECK (status IN ('draft','pending','active','paused','closed','expired','rejected'));
--> statement-breakpoint
ALTER TABLE jobs ADD CONSTRAINT job_salary_check CHECK ((salary_min IS NULL OR salary_min>=0) AND (salary_max IS NULL OR salary_max>=0) AND (salary_min IS NULL OR salary_max IS NULL OR salary_min<=salary_max) AND ((salary_min IS NULL AND salary_max IS NULL) OR (currency IS NOT NULL AND salary_period IS NOT NULL)));
--> statement-breakpoint
ALTER TABLE checkout_attempts ADD CONSTRAINT checkout_positive_check CHECK (amount>0 AND duration_days>0 AND active_jobs>0);
--> statement-breakpoint
ALTER TABLE job_sources ADD CONSTRAINT source_interval_check CHECK (interval_minutes>=15);
--> statement-breakpoint
INSERT INTO subscription_plans (id,name,amount,currency,duration_days,active_jobs,featured) VALUES
 ('growth-usd','Growth',4900,'USD',30,10,true),('growth-ngn','Growth Nigeria',5000000,'NGN',30,10,true) ON CONFLICT DO NOTHING;

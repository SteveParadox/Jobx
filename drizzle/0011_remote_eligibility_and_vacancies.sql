ALTER TABLE jobs
  ADD COLUMN remote_eligibility text NOT NULL DEFAULT 'unknown',
  ADD COLUMN vacancy_count integer;
--> statement-breakpoint
ALTER TABLE jobs
  ADD CONSTRAINT jobs_remote_eligibility_valid
  CHECK (remote_eligibility IN ('unknown', 'restricted', 'worldwide'));
--> statement-breakpoint
ALTER TABLE jobs
  ADD CONSTRAINT jobs_vacancy_count_nonnegative
  CHECK (vacancy_count IS NULL OR vacancy_count >= 0);
--> statement-breakpoint
-- Preserve confirmed eligibility only for existing approved-source-owned records.
-- Unowned historical Apify imports have no reliable origin evidence and stay unknown.
UPDATE jobs
  SET remote_eligibility = 'restricted'
  WHERE workplace = 'remote'
    AND source_owner_id IS NOT NULL
    AND cardinality(remote_countries) > 0;
--> statement-breakpoint
CREATE INDEX jobs_remote_eligible_countries_gin_idx
  ON jobs USING GIN (remote_countries)
  WHERE workplace = 'remote'
    AND remote_eligibility = 'restricted'
    AND status = 'active';

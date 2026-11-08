ALTER TABLE jobs
  ADD COLUMN remote_eligibility text NOT NULL DEFAULT 'unknown',
  ADD COLUMN vacancy_count integer;
ALTER TABLE jobs
  ADD CONSTRAINT jobs_vacancy_count_nonnegative
  CHECK (vacancy_count IS NULL OR vacancy_count >= 0);
-- Only source-owned jobs have an established approved-source provenance.
-- Legacy Apify direct imports must not be assigned inferred eligibility.
UPDATE jobs
  SET remote_eligibility = 'restricted'
  WHERE workplace = 'remote' AND source_owner_id IS NOT NULL
    AND cardinality(remote_countries) > 0;

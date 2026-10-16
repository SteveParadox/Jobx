-- Forward-only ownership backfill. Listings edited by a human retain employer control.
UPDATE jobs j SET source_owner_id=(SELECT m.source_id FROM source_job_mappings m WHERE m.job_id=j.id ORDER BY m.last_observed_at, m.id LIMIT 1)
WHERE EXISTS(SELECT 1 FROM source_job_mappings m WHERE m.job_id=j.id)
AND NOT EXISTS(SELECT 1 FROM job_change_history h WHERE h.job_id=j.id AND h.actor_id IS NOT NULL AND h.change->>'type'='edit');
--> statement-breakpoint
-- Legacy sources require an explicit review under the new endpoint/usage policy.
UPDATE job_sources SET enabled=false,approval_status='pending',health='unconfigured',next_sync_at=null;
--> statement-breakpoint
CREATE UNIQUE INDEX ingestion_tasks_one_active_source_idx ON ingestion_tasks(source_id) WHERE status IN ('queued','running','retrying');
--> statement-breakpoint
CREATE INDEX sources_due_idx ON job_sources(next_sync_at) WHERE enabled=true AND approval_status='approved';
--> statement-breakpoint
CREATE INDEX jobs_source_owner_idx ON jobs(source_owner_id);
--> statement-breakpoint
CREATE INDEX ingestion_errors_retention_idx ON ingestion_errors(created_at);
--> statement-breakpoint
ALTER TABLE job_sources ADD CONSTRAINT source_approval_state CHECK(approval_status IN ('pending','approved','revoked'));
--> statement-breakpoint
ALTER TABLE job_sources ADD CONSTRAINT source_schedule_bounds CHECK(interval_minutes BETWEEN 15 AND 10080 AND missing_confirmations BETWEEN 2 AND 10 AND missing_grace_minutes BETWEEN 15 AND 10080);
--> statement-breakpoint
ALTER TABLE ingestion_tasks ADD CONSTRAINT ingestion_task_state CHECK(status IN ('queued','running','retrying','completed','failed','cancelled'));
--> statement-breakpoint
ALTER TABLE ingestion_tasks ADD CONSTRAINT ingestion_task_kind CHECK(kind IN ('sync','test','import'));
--> statement-breakpoint
ALTER TABLE ingestion_tasks ADD CONSTRAINT ingestion_task_attempts CHECK(attempts>=0 AND max_attempts>=1);

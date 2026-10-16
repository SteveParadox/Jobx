# Operations

## Daily checks

Check `/api/ready`, the `primary` heartbeat, failed sync runs, stale enabled sources, pending moderation, expiring jobs, delivery review rows and payment exceptions. Inspect structured worker logs and audit IDs. Alert on repeated readiness failures, failed synchronization, unprocessed outbox commands, stale heartbeat and any provider mismatch. Logs and database state are implemented; external paging/error-monitoring accounts must be configured by the operator.

The worker creates a durable minute scheduler. BullMQ jobs retry up to five times with exponential backoff; failures remain visible rather than being silently discarded. Successful jobs are retained for up to a day and failures up to a week within configured caps. Use persistent Redis, no eviction and safe network access.

## Recover a source

1. Inspect the latest run and recorded error.
2. Verify the permission, board identifier, provider quota and employer identity.
3. Do not bypass a provider block or protection.
4. Re-enable the source only after resolution; queue sync in Admin → Sources.
5. Run a queued source test for the current revision, then review pending/restored listings. A temporary failed fetch never counts as a missing snapshot.

A disabled sole source pauses its active records without deleting history. Two spaced successful complete snapshots are needed for absence closure.

## Recover messaging

Check sender configuration and provider errors. Retries reuse a stable provider idempotency key and payload. [Resend retains idempotency keys for 24 hours](https://resend.com/docs/dashboard/emails/idempotency-keys). The worker commits `first_attempt_at` before making a provider request; a later database rollback cannot erase that marker. An ambiguous delivery moves to review after 23 hours rather than automatically risking duplicate email. Legacy attempted records without a marker use their creation time conservatively. Review records are never automatically sent. Verify provider history before manually retrying them.

Each send holds a delivery row lock during the bounded provider call, so simultaneous workers cannot both send the same record. Provider idempotency still handles acceptance followed by a worker/database failure. Failures persist attempt/error state and then propagate for BullMQ backoff. The production PostgreSQL/multi-process recovery behavior still requires staging verification; the integration suite exercises these cases in PGlite's serialized engine.

Paused/unsubscribed alerts, in-app-only channels, global email opt-out, disabled/unverified recipients and changed email addresses are checked immediately before send. Changing alert criteria or delivery channel cancels old queued digests. A changed recipient cancels the old delivery instead of changing an ambiguous provider retry's payload. Changing sender/provider configuration during retries requires operator review because the provider also compares the request payload. A send already in progress cannot be recalled.

The minute scheduler also prunes search-history entries older than 90 days using the retention index. Disabled history is erased immediately by the settings transaction. Monitor worker readiness for retention work as well as ingestion and messaging.

## Payments

Use authorized reconciliation to re-fetch provider truth. Never manually mark a redirect or client screenshot paid. Keep transaction/invoice/subscription updates atomic. Late/partial/refund exceptions need accounting review. For a restore, compare provider-paid references against unsettled server attempts before resuming paid entitlements.

## Backups and restore

Use managed encrypted PostgreSQL point-in-time recovery and daily snapshots. Back up Redis persistence and the private object bucket with an appropriate retention/version policy. Perform a restore drill into isolated infrastructure, run migrations/checks, compare essential counts and validate tenant access. Keep the restored site noindex and outbound email disabled until reconciliation is complete.

For a serious incident: stop web writes and worker processing, preserve audit/provider logs, rotate affected credentials, recover into isolated resources, validate integrity and only then resume. Do not replay notifications blindly. Application rollback uses a prior image compatible with the current schema; destructive reverse migrations are not the default.

## Production measurement

Core Web Vitals targets are goals, not measured results from small local fixtures. Configure real-user measurements only with appropriate consent and privacy settings. Review database slow queries, ingestion durations, failures and application conversion definitions. External apply clicks are not completed applications.

## Ingestion dead-letter and replay

Admin → Sources shows the most recent 100 source runs/tasks and quarantine records, plus queue counts and heartbeat. `ingestion_tasks` is the authoritative dead-letter view. Permanent failure or exhausted attempts sets source health to `dead_letter`, stopping automatic rescheduling without falsely expiring existing jobs. Resolve the exact error/permission issue, then use Retry task or a new queued test. Manual replay creates a fresh dispatch identity while database claiming prevents duplicate effective work.

A lease-expired worker is recovered after ten minutes. A stale acknowledged command for an unclaimed task is reissued after ten minutes; pending commands remain durable during broker outages. Cancelling a task stops that occurrence. Disable the source to stop recurrence. Changed/revoked/expired permissions withdraw source-owned records and indexing membership; they do not erase forensic history or overwrite employer-managed copies.

Configure monitoring for `dead_letter`, repeated source failures, overdue `next_sync_at`, expired leases, nonempty undispatched outbox, quarantine spikes and stale heartbeat. Raw payload retention needs the persistent minute worker. Source-specific confirmation counts/gaps are documented in JOB_INGESTION; never reset missing counters because a fetch failed.

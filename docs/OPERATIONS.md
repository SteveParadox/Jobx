# Operations

## Daily checks

Check `/api/ready`, the `primary` heartbeat, failed sync runs, stale enabled sources, pending moderation, expiring jobs, delivery review rows and payment exceptions. Inspect structured worker logs and audit IDs. Alert on repeated readiness failures, failed synchronization, unprocessed outbox commands, stale heartbeat and any provider mismatch. Logs and database state are implemented; external paging/error-monitoring accounts must be configured by the operator.

The worker creates a durable minute scheduler. BullMQ jobs retry up to five times with exponential backoff; failures remain visible rather than being silently discarded. Successful jobs are retained for up to a day and failures up to a week within configured caps. Use persistent Redis, no eviction and safe network access.

## Recover a source

1. Inspect the latest run and recorded error.
2. Verify the permission, board identifier, provider quota and employer identity.
3. Do not bypass a provider block or protection.
4. Re-enable the source only after resolution; queue sync in Admin → Sources.
5. Review pending/restored listings. A temporary failed fetch never counts as a missing snapshot.

A disabled sole source pauses its active records without deleting history. Two spaced successful complete snapshots are needed for absence closure.

## Recover messaging

Check sender configuration and provider errors. Retries reuse a stable provider idempotency key. An ambiguous delivery outside the provider's 24-hour idempotency window is moved to review after 23 hours rather than automatically risking duplicate email. Verify provider history before manually retrying it. Paused/unsubscribed alerts are checked again immediately before send.

## Payments

Use authorized reconciliation to re-fetch provider truth. Never manually mark a redirect or client screenshot paid. Keep transaction/invoice/subscription updates atomic. Late/partial/refund exceptions need accounting review. For a restore, compare provider-paid references against unsettled server attempts before resuming paid entitlements.

## Backups and restore

Use managed encrypted PostgreSQL point-in-time recovery and daily snapshots. Back up Redis persistence and the private object bucket with an appropriate retention/version policy. Perform a restore drill into isolated infrastructure, run migrations/checks, compare essential counts and validate tenant access. Keep the restored site noindex and outbound email disabled until reconciliation is complete.

For a serious incident: stop web writes and worker processing, preserve audit/provider logs, rotate affected credentials, recover into isolated resources, validate integrity and only then resume. Do not replay notifications blindly. Application rollback uses a prior image compatible with the current schema; destructive reverse migrations are not the default.

## Production measurement

Core Web Vitals targets are goals, not measured results from small local fixtures. Configure real-user measurements only with appropriate consent and privacy settings. Review database slow queries, ingestion durations, failures and application conversion definitions. External apply clicks are not completed applications.

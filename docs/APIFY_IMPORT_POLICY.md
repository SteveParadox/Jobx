# Apify imports: authorization, publication and reconciliation

The Apify actor is a data transport, **not** an employer identity verifier or a redistribution license. Its payload may contain unconfirmed metadata. Jobs are only persisted through the canonical source synchronizer, which records provenance, applies the existing source permissions, validates application hostnames and job fields, and obeys publication policy.

## Setup (administrator only)

1. Keep `APIFY_IMPORT_ENABLED=false` until the migration, source review and verification are complete. Supply `APIFY_TOKEN` only in the worker environment, and optionally `APIFY_ACTOR_ID`; never place tokens in source URLs or application code.
2. Run `npm run apify:import -- --dry-run` with test/dummy inputs, or `APIFY_DATASET_FILE=...` in development. Output lists each employer, candidate job and deterministic source board token. Dry run does not create employers, sources or jobs.
3. For each intended employer, first establish a real employer record and perform **separate identity verification** with evidence. The importer **never** creates, takes over or verifies employer accounts. Review name and canonical HTTPS website matches.
4. In the admin source registry, register a **`manual_apify`** source for that employer with the dry-run board token. Record permission/redistribution evidence, usage and removal terms, source attribution, authorized application hostnames and approved fields. Grant date/salary/skills/employment fields only when explicitly permitted. The source starts pending and disabled. A given actor and employer pair needs its own source.
5. An administrator reviews and approves the source, then enables it. `autoPublish` defaults to **false** and must be explicitly granted during source review. With false, validated imports remain pending until separately moderated and published. Even when true, other publication gates remain in force.
6. Enable scheduled imports only after those checks, with `APIFY_IMPORT_ENABLED=true`. Worker runs use the normal synchronization service, transaction and source leases. A run that succeeded in fetching does **not** imply an approved or published job.

**Important:** Sources marked `manual_apify` cannot be uploaded through the general manual-import HTTP endpoint. Only the dedicated worker/CLI actor importer can submit their rows.

## Eligibility and publication rules

Location or AI-derived country labels are not applicant eligibility. Newly imported Apify remote jobs have `remote_eligibility='unknown'` and no confirmed `remote_countries`; no country eligibility filter will match them until employer-confirmed evidence is supplied through an authorized workflow. Existing source-owned remote jobs with explicit countries are migrated to `restricted`. Historical unowned jobs remain `unknown`. The UI states uncertainty instead of claiming worldwide reach.

The platform keeps verified employer status, approved ingestion source, source-enabled state, job moderation status, source auto-publish permission and actual public availability separate. Source revocation/disable and expired authorization hide source-owned jobs and preserve history. A rejected, closed, expired or paused job never becomes active solely because it reappears in a subsequent Apify dataset. Existing pending Apify jobs also require explicit administrator publication: enabling auto-publish later or resubmitting a paused/rejected listing does not silently release its earlier moderation hold. Auto-publish applies to first-time eligible source records, not to previously pending ones. An explicitly closed item may close an active job; a time-limited/filtered dataset never closes merely absent items.

## Source provenance and retention

New records use the existing `jobs.source_owner_id` and unique `source_job_mappings(source_id, external_id)`. Mapping payload contains Apify provider, configured actor identifier, original URL and observation timestamp. Sync run, first/last observation, original posted date, job changes and failure details use existing tables and retention policies. The current sync-get-dataset-items API does **not** return trustworthy Apify run/dataset IDs, so those identifiers are not recorded unless the API and storage schema are explicitly extended.

The job identity is source-scoped. Never use employer name, shared application URL, or similar content alone to assign historic ownership. The source registry identity is what permits refresh and revocation. In a partial input, absent optional fields retain their previously authorized values; explicitly present nulls can clear them if permitted. Rejected records are quarantined by the existing ingestion service.

## Historical Apify records: safe reconciliation

Earlier Apify code directly created unowned jobs. **Do not backfill these blindly.** The migration only adds eligibility/vacancy fields, without modifying ownership. Run the **read-only** inventory with `npm run apify:reconcile` against a staging copy (up to 500 unowned external jobs) and review the following equivalent SQL:

```sql
SELECT j.id, j.title, j.apply_url, j.employer_id, e.name AS employer,
       e.verification_status, j.status, j.source_owner_id, j.created_at
FROM jobs j JOIN employers e ON e.id = j.employer_id
WHERE j.source_owner_id IS NULL AND j.application_method = 'external'
ORDER BY j.created_at DESC;
```

This set includes both legitimate employer-submitted jobs and potentially old Apify imports; it is **not** a proven Apify list. Confirm Apify dataset item ID, actor, original URL, employer ownership and original insertion evidence against trusted logs/backups before an administrator links any historical job to a source. Flag ambiguous records for review. A future audited reconciliation tool should require explicit per-job authorization and ensure no conflicting mapping or employer ownership. Do not revoke/delete unowned jobs using a guessed source.

## Deployment and verification

Apply `drizzle/0011_remote_eligibility_and_vacancies.sql` via `npm run db:migrate` in staging before deploying code that selects the new columns. Back up the database. Do not apply the migration blindly against production. Validate with `npm ci`, `npm run format:check`, `npm run typecheck`, `npm run lint`, `npm run test`, `npm run db:migrate`, `npm run build` and `npm run test:e2e` in isolated CI/staging. PostgreSQL integration tests require `TEST_POSTGRES_URL` pointing to disposable test data, not production. `APIFY_IMPORT_ENABLED` stays false until the policy review is complete.

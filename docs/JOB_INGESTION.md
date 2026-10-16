# Autonomous authorized ingestion

This subsystem runs in the persistent worker. Source registration, permission review and task creation are HTTP operations; fetching, browser execution, normalization, persistence and reconciliation are background work. No real source is enabled by default, and no source redistribution license is claimed by this repository.

## Adapters and discovery

| Provider                                  | Discovery/configuration                                            | Behavior                                                                                           |
| ----------------------------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| `greenhouse`                              | Board token → fixed `boards-api.greenhouse.io` endpoint            | Public Job Board API, complete jobs envelope                                                       |
| `lever`, `lever_eu`                       | Site token → fixed global/EU API host                              | Offset pagination, page-cycle/limit protection                                                     |
| `ashby`                                   | Board token → fixed `api.ashbyhq.com/posting-api/job-board/…`      | Listed jobs only; explicit workplace/employment/compensation fields                                |
| `authorized_json`, `authorized_xml`       | Employer-approved exact endpoint/hostname                          | Record paths, field mapping, optional next URL or page-number pagination                           |
| `authorized_rss`                          | Approved RSS/Atom endpoint                                         | Partial window by default; closure reconciliation only with a documented complete-catalog contract |
| `authorized_html`                         | Approved career page and CSS selectors                             | HTTP parsing with Cheerio; optional same-host detail pages and pagination                          |
| `authorized_browser`                      | Approved career page plus explicit JavaScript-execution permission | Optional Playwright worker; complete job records on rendered catalog pages                         |
| `licensed_json`                           | Licensed endpoint plus optional environment-token reference        | JSON interface for licensed providers; no embedded credentials                                     |
| `manual_json`, `manual_csv`, `manual_xml` | Approved administrator complete upload                             | Existing 180 KB / 1,000-record durable import workflow                                             |

Discovery stays inside a registered source's approved scope. It resolves known ATS endpoints or follows configured employer links; it does not search the web and assume permission. Provider documentation:

- [Greenhouse Job Board API](https://docs.greenhouse.io/job-board.html)
- [Lever Postings API](https://github.com/lever/postings-api)
- [Ashby public Job Postings API](https://developers.ashbyhq.com/docs/public-job-posting-api)

Ashby's `publishedAt` is documented as the last publication. It is retained as a source observation, not falsely displayed as the original posting date. Unknown country codes, remote applicant countries, salary and other claims remain unknown. In particular, a remote label does not establish worldwide eligibility. Explicit ISO alpha-2/alpha-3 country codes normalize through the maintained ISO country table; unsupported labels remain in the raw source record instead of being guessed.

## Local worker setup

Use Node 22.13+ and an isolated PostgreSQL/Redis instance:

```bash
npm ci
# Copy .env.example to .env and configure the values.
docker compose up -d --wait
npm run db:migrate
npm run validate:env
npm run dev
# A separate terminal, in the same checkout/environment:
npm run worker
```

On Windows CMD, copy the template with `copy .env.example .env`. If your Docker ports are mapped to PostgreSQL **5433** and Redis **6380**, use `DATABASE_URL=postgresql://careeratlas:careeratlas@localhost:5433/careeratlas` and `REDIS_URL=redis://localhost:6380`. Use the actual mappings from `docker compose ps`; the repository's default mapping is 5432/6379.

Create and verify an account, then promote the intended operator with `npm run admin:grant -- operator@example.com`. The worker must keep running. `/api/ready` checks its heartbeat along with core services.

## Approval and first synchronization

1. Obtain actual employer/provider authorization covering access, redistribution, display fields, attribution and removal. Public accessibility is not a license.
2. Create and verify the real employer with its official website.
3. Open Admin → Sources. Register the provider/token, exact approved endpoint when custom, approved application hostnames, permission evidence, allowed usage, attribution, removal rules, authorization expiry and fetch interval.
4. Select only authorized display fields. Core title/description/location/application permission is required. Structured salary, skills, employment and experience fields require their respective scope; unlicensed normalized fields are not published.
5. Save the source. It starts **disabled and pending**. Use the permission-review form to record an approval decision and evidence.
6. Queue a source test. An approved source can be tested while disabled. The worker fetches/normalizes and records quarantine results without writing jobs. Inspect health, completeness, errors and request/time totals.
7. Enable scheduling only after a successful test for the current configuration revision. Manual sources instead use the approved upload workflow.
8. Queue a first synchronization or wait for the next worker tick. Review pending jobs. Automatic publication is an explicit source setting and still requires a verified employer, permitted data, safe URLs and known location/workplace semantics.
9. Check `/jobs`, the canonical job detail, visible attribution, and source/task counters. A staging site remains noindex. Original dates and eligible location data are necessary for production JobPosting markup.

Editing source identity-sensitive configuration requires a new approval/test and disables its schedule. Changing provider, employer or board identity requires a new source. Revocation or authorization expiry withdraws source-owned public listings and queues indexing removal. A human edit to an imported job transfers that public copy to employer control; later source updates/removal signals cannot overwrite or close it.

## Adapter settings

Settings are validated JSON, not executable code. Defaults include 20 pages, 100 records/page where applicable, 50 requests, 5,000 records, 5 MB per response, 15-second request timeouts, 20 requests/minute/host, and a 180-second overall processing budget. Hard upper limits apply. A feed exceeding a budget fails safely rather than claiming complete reconciliation. Tune limits and source size using measured staging runs.

A normalized JSON feed can use:

```json
{
  "robots": true,
  "recordsPath": "jobs",
  "nextPath": "next",
  "completePath": "complete",
  "emptyMeansComplete": true,
  "maxPages": 20,
  "maxRequests": 50,
  "requestsPerMinute": 20
}
```

`nextPath` identifies a next-page URL or null. Alternatively, `pageParameter` advances a page-number query until an empty terminal page. Without pagination settings, the endpoint contract must guarantee a complete snapshot. Explicit `hasMore` flags without a configured next-page mapping are rejected. `completePath` must be a true boolean; a false/missing value prevents closure reconciliation. An empty JSON/XML feed needs `emptyMeansComplete=true` under the approved contract.

For XML `<jobs><job>…</job></jobs>`, set `recordsPath` to `jobs.job`. DTD/entity declarations are rejected. RSS/Atom defaults to incomplete: only set `fullCatalog=true` when the source agreement guarantees every active vacancy is included. A recent-items feed must never expire unseen jobs.

Field mapping uses dot paths in `fieldMap`, for example `{"externalId":"id","descriptionHtml":"description","locationLabel":"location.name"}`. Prototype/constructor paths and excessively deep paths are rejected. The normalized fields use the existing job model. JSON feed records can contain:

```json
{
  "externalId": "actual-employer-requisition-id",
  "sourceUrl": "https://employer.example/careers/actual-id",
  "applyUrl": "https://employer.example/careers/actual-id/apply",
  "title": "Actual employer title",
  "descriptionHtml": "<p>Supply the full authorized description, responsibilities, qualifications and benefits here. This is a documentation shape, not a real vacancy.</p>",
  "locationLabel": "Actual employer location label",
  "country": "NG",
  "workplace": "onsite"
}
```

Do not publish documentation examples as live inventory. Descriptions remain the authority for qualifications/benefits; the system does not invent them through keyword extraction. Explicit `responsibilities`, `qualifications`, and `benefits` strings/arrays, or their `…Html` variants, are sanitized and appended as labeled description sections. Fully remote eligibility is populated only from explicit applicant-country data.

For HTML, configure `itemSelector`, `titleSelector`, `descriptionSelector`, `locationSelector`, `applySelector`, and `idAttribute`. Optional `nextSelector`, `detailSelector` and `emptySelector` identify pagination, same-host description pages and a verified empty state. Default selectors are `[data-job-id]`, `h2`, `.description`, `.location`, `a.apply`, and `data-job-id`. Missing selectors are a shape failure, not an empty catalog. Job IDs fall back to a stable source-URL hash when no explicit ID exists.

## Permitted application-link checking

Opt-in `checkApplicationLinks=true` also requires `applicationFetchPermitted=true` under the source agreement. Checks use the same hostname/DNS/robots/timeout protections, without source credentials, and share the overall request budget. Safe same-host redirects update the canonical application destination. Cross-host redirects require review even if another hostname is listed. A verified HTTP 410 closes a source-owned job; HTTP 404 or an unsafe redirect pauses it for review, rather than inventing an expiry date. Network/5xx outages do not close vacancies. A later valid observation can restore the source-owned record under its current publication policy.

Link checking is off by default because display permission does not establish permission to fetch an application system. Large feeds need an appropriate request budget or separately authorized smaller complete feeds. The browser does not verify completion of an external candidate application.

## JavaScript rendering

Set `SOURCE_BROWSER_ENABLED=true` only in an appropriate persistent worker, and record `browserPermitted=true` in the approved source settings. Build the optional Docker `worker-browser` target, which installs Chromium and OS dependencies. Keep the web deployment on the ordinary web target. Chromium runs as a non-root user with its sandbox enabled; the host must support that sandbox. Do not disable it to work around deployment restrictions.

The browser blocks service workers, WebSockets, frames, downloads, POSTs, images and unrelated hosts. All permitted network GETs are fulfilled through the DNS-pinned HTTP guard and request budget; Chromium does not get a bypass path to internal networks. A restrictive CSP limits rendering. `waitForSelector` can identify completion; records must contain full descriptions on the rendered catalog page. Sites requiring cross-host scripts, login, CAPTCHA or access-control bypass are not supported by this adapter.

The browser adapter is implemented and gated, but actual Chromium ingestion was not executed in the managed authoring environment. Keep it disabled until the permitted source and browser worker have been verified together in staging.

## Durable execution and recovery

The minute scheduler writes one active `ingestion_tasks` row per source and an outbox command in the same PostgreSQL transaction. A partial unique index prevents duplicate active tasks. Dispatch uses stable BullMQ job IDs; acknowledgement follows successful queue insertion. PostgreSQL task/source leases, employer/job locks and source-ID constraints protect replay and concurrent imports.

Transient failures enter durable retry state with exponential backoff and jitter; `Retry-After` takes precedence. Five attempts are the initial budget. Permanent errors or exhausted retries enter the database dead-letter view and stop automatic scheduling for that source. Inspect/fix the failure, then explicitly retry or test the source. Manual retry gets a fresh queue identity, including tasks cancelled before their first claim.

A lost worker lease is recovered by a later tick. A stale acknowledged command for a still-queued task is reissued with a new dispatch identity after ten minutes; database claiming still allows only one effective processor. Queued cancellations finish without fetching. In-flight cancellation is checked between requests and periodically during persistence, before committing the public snapshot. Disable the source to stop future recurrences; cancelling one task does not revoke its schedule.

Fetch → parse → per-record validation/quarantine → normalize/sanitize → source identity/cross-source alias → transactionally persist canonical jobs/mappings/history → generated PostgreSQL search vector → public availability → dynamic sitemaps/conditional indexing queue → matching alert worker.

Valid rows from a partially malformed snapshot may persist, while quarantine records retain their reason. **No absence reconciliation runs unless the snapshot is complete.** Two complete observations at least an hour apart are the defaults; `missingConfirmations` and `missingGraceMinutes` are source-specific. An observed authorized alias can prevent closure. Employer-managed jobs are protected. No outage resets posting dates or counts as a missing snapshot.

Search vectors and jobs commit together; an indexing/constraint failure rolls back jobs, mappings and publication. Public job/search/sitemap routes read canonical state dynamically, so there is no separate browser catalog or stale page cache to invalidate. Google submissions remain optional and never guarantee indexing.

## Security and retention

Only public HTTPS endpoints are accepted. Exact hostnames, all resolved IP answers, redirect targets, MIME types, body/header sizes, timeouts, robots directives and per-host request pacing are checked. DNS answers are pinned into the TLS connection to prevent rebinding. Private, loopback, metadata, link-local, reserved and mapped private IPs are rejected. Authentication/access restrictions are not bypassed. Suspicious fee language and unapproved application hosts enter quarantine.

An optional licensed bearer credential is referenced by a name such as `JOB_SOURCE_TOKEN_VENDOR` in `config.credentialEnv`. Put its value in the worker secret manager, never in source URLs, configuration JSON, Git or logs. Credentials are sent only to the approved source hostname, not robots or application checks.

Raw observed payloads and quarantined payloads are private and bounded; the worker clears raw payloads after 30 days without observation. Finished task upload payloads are also cleared under retention. Normalized provenance and audit/change history remain for operator review. Apply a legally reviewed operator retention policy to production data.

## Add a licensed adapter

Implement `SourceAdapter` from `src/integrations/sources/contracts.ts`: a unique `licensed_…` provider name, `discover(source)` and `fetch(context)` returning records, rejected records, completeness and request counts. Use `context.request` for all network access. Register trusted application code with `registerLicensedAdapter` from the adapter registry, in initialization shared by the web source-registration service and worker. Never accept uploaded scripts or `eval`. Keep field mapping declarative. Add fixtures for envelopes, pagination, limits, errors and closure semantics before enabling it.

## Test and troubleshoot

```bash
npm run typecheck
npm run lint
npm test
npm run build
# With an isolated real Redis instance, in bash:
TEST_REDIS_URL=redis://localhost:6379 npm run test:integration
# Windows CMD:
# set TEST_REDIS_URL=redis://localhost:6380
# npm run test:integration
```

The recorded-fixture suite applies actual PostgreSQL migrations through PGlite. The opt-in real Redis/BullMQ test executes schedule/outbox/worker/persistence/search, duplicate delivery identity, worker restart, updates and confirmed closure. It does not establish multi-host PostgreSQL contention, real provider licensing, or browser rendering. GitHub CI enables that test against its Redis service when runners are available.

Admin → Sources shows permissions, active mapped jobs, recent run counts/durations, next sync, queue/worker health, task cancellation/retry and quarantine reasons. Metrics are explicitly the most recent 100 runs/tasks, not fabricated lifetime totals. Diagnose from task ID → run ID → source revision → error code. For failed fetches, check approval expiry, exact hostname, DNS, robots, response type, parser paths/selectors, provider limits and credentials. Never resolve a failure by bypassing a source restriction.

Before public production ingestion, provision the persistent worker/database/broker, run multi-process PostgreSQL and crash/restore checks, validate one genuinely approved source end to end, verify public URLs/JobPosting where eligible, and measure representative load. Browser sources additionally need the sandboxed browser-worker check. The authoring report distinguishes the checks actually executed from these external prerequisites.

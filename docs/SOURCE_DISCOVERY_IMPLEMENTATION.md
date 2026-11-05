# Permission-aware source discovery

## Current scope

The discovery worker accepts a bounded list of operator-supplied HTTPS seed URLs and performs limited career-page discovery. It recognizes Greenhouse, Lever (US/EU), and Ashby board patterns, checks the seed host's `robots.txt`, inspects a small number of same-host career pages and sitemaps, deduplicates candidates, and records evidence and run history.

Network access is constrained: HTTPS only, public DNS answers only, the validated IP is pinned for the socket connection, cross-host redirects are rejected, and requests have byte, time, redirect, page, sitemap, and candidate limits. External ATS URLs found on a career page are recorded as candidates but are not fetched as part of that host's crawl. Robots policy is checked before crawling career pages and sitemaps.

Candidates appear in **Admin → Discovery**. An administrator can mark a candidate as identified, keep it in review, or reject it with a required note. Human review state is preserved across later scans.

## Enable scheduled discovery

Set these environment variables for the persistent worker and web service:

```dotenv
JOB_DISCOVERY_ENABLED=true
JOB_DISCOVERY_SEEDS=https://example.com/careers,https://jobs.ashbyhq.com/example
JOB_DISCOVERY_INTERVAL_MINUTES=60
```

The seed list accepts newline, comma, or semicolon separators. At most 25 unique seeds are accepted per run and at most 1,000 candidates are processed per run. Runs that remain marked running beyond 30 minutes are marked failed so they cannot block future scans indefinitely. Each seed crawl is bounded to a small number of pages and sitemaps. The interval must be between 15 minutes and 7 days. Discovery is disabled by default.

Run the normal database migration command after deploying the code:

```sh
npm run db:migrate
```

This adds the `discovery_candidates` and `discovery_runs` tables. It does not change existing source approval or publication behavior.

## Review and source draft workflow

1. Run discovery manually in Admin → Discovery, or enable the scheduled worker.
2. Inspect candidate URL, detected ATS provider, board token, and recorded evidence.
3. Save a review note and choose identified, review-required, or rejected.
4. For an identified supported ATS candidate, use **Create disabled source draft** only after verifying the employer and documenting explicit permission for the intended access, storage, attribution, display, and redistribution.
5. The employer must already have a verified status. The source draft is created disabled with approval pending; it cannot ingest or publish.
6. Finish the normal source approval process, confirm permitted fields, application hostnames, usage conditions, removal policy and any authorization expiry. Run a source test before enabling scheduled ingestion.
7. Job moderation/publication remains a separate decision.

**A publicly reachable URL is not proof of permission to scrape, store, or republish its content.** Candidate review and draft creation do not grant that permission.

## Security boundaries and limitations

- Discovery does not create employer records or mark employers as verified.
- Public DNS answers are checked and the chosen address is pinned for each HTTPS request. All returned DNS answers must be public unicast addresses.
- Redirects must remain on the original host. The crawler does not fetch external ATS pages while crawling employer domains.
- Requests have a 6-second total deadline and 1 MB response limit. Requests to the same hostname are paced through PostgreSQL host reservations at least one second apart across workers; each seed is limited to a small number of pages and sitemaps. A run is limited to 1,000 persisted candidates.
- A crawl that cannot safely check `robots.txt` is rejected rather than proceeding blindly.
- The crawler does not extract job listings or publish records. Actual ingestion continues through the existing source adapter, permission approval, source test, ingestion task, and moderation paths.
- Discovery is not a substitute for verifying source permissions, provider terms, data retention rules, or employer identity.

## Audit fixes and verification — November 5, 2026

The administrator review form now submits the verified employer identity required by the API. Source drafts reuse that reviewed employer identity. The hostname list parser preserves letters such as `n` and accepts actual newlines, commas and semicolons. Candidate evidence retains its observation kind instead of collapsing all ATS observations into the same entry.

Discovery now uses the shared DNS-pinned ingestion transport, which supports Node's multi-address lookup callback, disables pooled socket reuse, and bounds DNS resolution as part of the request deadline. Every redirect destination is checked against robots rules before fetching. Robots-declared same-host sitemaps are considered before the default sitemap, and malformed individual links cannot discard the remaining page candidates. Retry-After is never shortened: a cooldown beyond the bounded retry window ends the attempt without an early retry. Host cooldowns are retained in PostgreSQL so the next scheduled run and other workers cannot bypass them.

Each seed has a 60-second budget and a run has a ten-minute budget. Candidate persistence locks and checks the owning run before writing; final settlement only changes an active run. Recovered workers cannot overwrite the recovery failure or persist late candidate results. Failed seeds produce a failed run eligible for the next tick, and database write failures propagate instead of being reported as successful discovery. Completion timestamps reflect actual settlement time.

The persistent worker dispatches discovery as a separate queue job, keeping the platform tick and heartbeat independent of slow crawls. New regression coverage includes a real worker process crash/restart and stale-run recovery, plus PostgreSQL discovery → review → disabled draft → approval → source test → ingestion → moderation → public-search acceptance using recorded transport fixtures. No source permission is inferred from discovery.

The audit also repaired the saved-job loading state that blocked lint, completed the robots-parser type declaration, normalized existing formatting failures, and made the auth route overwrite its internal limiter identity from validated ingress data. Caller-supplied internal headers cannot choose a different authentication rate bucket. Auth tests now exercise the real route with a controlled trusted ingress rather than spoofing an untrusted forwarded header.

Local validation recorded in this audit:

- Full unit/integration suite: **234 passed, zero skipped**, including PostgreSQL contention, PostgreSQL/Redis lifecycle and persistent worker restart tests. Runtime: Node 22.21.1 (matching the CI major version), PostgreSQL 17.6, Redis 7.4.2.
- Typecheck, lint, formatting, whitespace checks, migrations, fixture seeding and production build passed.
- Four Playwright HTTP-only checks passed (two scenarios under both configured project names). These did not launch a browser.
- Full browser launch was attempted and blocked by the authoring environment's Unix-socket restriction. The new administrator review/draft UI regression remains unexecuted here. CI must run both desktop and mobile browser projects.
- Hosted CI previously failed before runner allocation; the local results do not establish a successful hosted run or live-source/staging certification. Keep the PR draft until the current-head workflow and browser suite pass.

CI retains JUnit results in `test-reports/` separately from Playwright's `test-results/` directory, which Playwright clears at startup. Verification artifacts are uploaded on successful and failed runs. The browser test server models a trusted ingress only in the isolated `APP_ENV=test` topology.

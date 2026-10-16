# Implementation and readiness report

This report describes the repository implementation, not a claim that external accounts or live data are connected.

## Completed implementation

Next.js/React/TypeScript application with server-rendered public discovery, responsive forms, PostgreSQL/Drizzle migrations, Better Auth registration/verification/reset, company/tenant roles, moderated employer jobs, search, saved jobs/searches, optional bounded search history, editable email/in-app alerts, global email opt-out, read/unread notifications, private quarantined PDFs, native applications, external activity tracking, team invitations, applicant stages/notes, administrative controls, editorial/curated pages, conditional JobPosting, canonical paths, segmented sitemaps, optional Indexing API and fixed-period provider-verified employer billing.

Redis and BullMQ isolate durable work from web requests. PostgreSQL records the outbox, source snapshots, errors, deduplication identities, indexing state and message attempts. Docker, Vercel/worker configuration, CI and setup/security/operations documentation are included.

## Ingestion status

| Adapter                      | Implementation / verification                                                                      | Live authorization                                                 |
| ---------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Greenhouse, Lever global/EU  | Guarded ATS discovery, parsing, bounded pagination and reconciliation                              | None configured                                                    |
| Ashby public Job Postings    | Listed-job filtering, structured fields, original-date safeguards; recorded parsing tests          | None configured                                                    |
| Authorized JSON/XML/RSS/HTML | Guarded HTTP, declarative mapping/selectors, quarantine and completeness policy; recorded fixtures | Requires real employer approval                                    |
| Authorized browser           | Gated Playwright adapter and optional sandboxed worker image; Chromium execution not performed     | Requires explicit source/browser permission and staging validation |
| Licensed providers           | `licensed_json` plus trusted `SourceAdapter` extension interface; secret references only           | Requires provider license/credentials                              |
| Manual JSON/CSV/XML          | Validated complete upload, durable task, source approval and canonical persistence                 | Requires authorized upload                                         |
| Employer submissions         | Verified accounts, native workflow and moderation                                                  | Requires deployed operator/database                                |

There are no fabricated production vacancies, scraped company logos, fake hiring counts or testimonials. Local fixtures are explicitly fictional, noindex and rejected by production startup.

## Verification

The local unit/integration suite applies actual PostgreSQL migrations through PGlite and tests business/security/SEO invariants. Production build, type, lint, format and dependency audit outcomes are recorded in the final commit/report after verification. Desktop/mobile Playwright suites and a real PostgreSQL/Redis CI topology are supplied. Browser/provider execution must be distinguished from test definitions.

No deployed real-user LCP/INP/CLS measurement, live Google Rich Results validation, source-license approval, antivirus deployment or provider sandbox settlement is claimed completed in the authoring environment.

## Remaining work / launch prerequisites

| Priority                       | Item                                                                                                    | Why it remains                                                                 |
| ------------------------------ | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| P1                             | Deploy isolated PostgreSQL, Redis, web and persistent worker; verify health/backup restore              | External infrastructure/account configuration                                  |
| P1                             | Authorize at least one real employer/source and publish reviewed genuine records                        | No redistribution permission supplied                                          |
| P1                             | Configure and verify sender, private storage and scanner operations                                     | External credentials/runtime services                                          |
| P1                             | Complete desktop/mobile E2E, accessibility and representative-load staging verification                 | Requires runnable deployment/browser infrastructure                            |
| P1                             | Complete operator identity, privacy/terms/refund/retention review before public launch                  | Legal/operator decisions cannot be invented                                    |
| P1 when paid access is enabled | Exercise both configured payment providers with real sandbox signatures and refund/reconciliation cases | No merchant sandbox credentials supplied                                       |
| P2                             | Automated Search Console OAuth/organic reporting and crawler-wide broken-link/duplicate audit           | Dashboard explicitly marks these disconnected                                  |
| P2                             | Advanced recurring subscriptions, automated failed-renewal handling and self-service partial refunds    | Current product deliberately uses fixed paid periods/manual renewal and review |
| P2                             | Multi-process contention/load testing and production Core Web Vitals                                    | Small local tests cannot establish these metrics                               |
| P3                             | Optional AI/semantic retrieval, more licensed APIs and fully localized versions                         | Core workflows operate with AI disabled                                        |

## Verdict

Suitable for staging deployment and integration validation after the core environment is provisioned. **Not yet certified ready for public production.** No known external dependency or unexecuted production validation is represented as resolved. Consult the CI run and final verification record for the exact committed test outcome.

## Recorded local verification

- `npm run typecheck`: passed (Next route type generation plus strict TypeScript).
- `npm run lint`: passed with no errors; the configuration warnings were corrected.
- `TEST_REDIS_URL=redis://127.0.0.1:6397 npm test`: **170 passed**, 9 test files, including migration-backed integration, real Redis/BullMQ ingestion lifecycle, candidate preference/recovery regressions and real authentication flows. Without `TEST_REDIS_URL`, the broker-specific case is intentionally skipped.
- `npm run build`: optimized Next.js production build passed; public inventory/detail routes are server-rendered.
- `npm run format:check` and `git diff --check`: passed.
- `npm run db:generate`: no schema changes after the forward migrations/snapshots were reconciled.
- `npm audit --omit=dev --audit-level=high`: **0 vulnerabilities** after replacing the affected transitive esbuild version with a tested override.
- The authoring runtime uses Node 24; CI selects the declared Node 22 deployment baseline.
- Local browser testing was not executed: the managed environment did not expose the browser-control capability required by the Sites workflow. The committed Playwright suite is configured to run against real PostgreSQL/Redis in GitHub Actions. CI status is reported separately from these local results.

## GitHub delivery and hosted CI

Application code was uploaded to `SteveParadox/Jobx`, `main`, in commit `bdf696780df7cea9e6a70737f3cbc7565900438b`. The local Git tree matched the remote tree exactly after upload.

[GitHub Actions run 38863304036](https://github.com/SteveParadox/Jobx/actions/runs/38863304036) failed **before a runner started**. The hosted runner was blocked by an account-level restriction. No CI steps or browser tests executed, and there were no job logs. This is an external account blocker, not a failed application test result.

Resolve the GitHub runner/account restriction, then run **Platform verification** manually from Actions (workflow dispatch is enabled) to verify the latest commit. The workflow pins Ubuntu 24.04 to avoid the announced `ubuntu-latest` image migration. Until that run and the external staging checks pass, the production-readiness verdict remains unchanged.

The continuation rechecked `main` against the local baseline, retried the hosted run, and observed the same account-level runner restriction before any steps started. Candidate controls are integrated through the UI, validated route handlers, transactional services, migration `0005_candidate_preferences.sql`, and persistent-worker retention/delivery checks. Duplicate send claims serialize on a delivery lock, and a precommitted first-attempt timestamp bounds crash recovery against the provider's idempotency window. No live source, merchant, email sender or deployed performance result was added or claimed.

## Autonomous ingestion addendum

Implemented approved source registry/revisions, all adapter types listed above, safe DNS-pinned fetching, robots/content/redirect/budget controls, per-record quarantine, explicit employer/source ownership, conservative source aliases, transactional canonical search publication, configurable absence confirmation, permitted application-link checks, source authorization expiry, durable task/outbox scheduling, database leases, jittered retries, dead-letter review, cancellation and manual replay. Admin → Sources exposes configuration, approval, tests, scheduling, metrics, queue/worker health and recovery.

Principal changes are `src/integrations/sources/{contracts,http,normalize,adapters,browser,link-checks}.ts`, `src/domain/{ingestion,ingestion-tasks,source-management}.ts`, `src/worker/ingestion.ts`, the existing worker/API/jobs/search integration, `src/components/ingestion-workspace.tsx`, source/task migrations, fixtures and three ingestion test modules. `docs/JOB_INGESTION.md` contains setup, approval, adapter extension, configuration examples and replay procedures. Deployment includes the optional `worker-browser` Docker target and `SOURCE_BROWSER_ENABLED=false` default.

Migration `0007_ingestion_guards.sql` deliberately disables legacy sources pending explicit approval under the new endpoint/usage policy. Jobs and provenance are retained, and employer-edited records retain employer control. Previously journaled SQL is unchanged. Unjournaled duplicate migration/snapshot artifacts were removed to prevent incorrect future schema generation.

The real Redis 7.4.11/BullMQ fixture test exercised schedule → outbox → worker → migrated database → full-text search → update → confirmed closure, including duplicate queue identity and worker stop/restart with queued work. Database behavior in that test is PGlite, not an independently running PostgreSQL server. Separate integration tests cover lease replay, cancellation, quota/permission boundaries, partial results, outages and injected transaction failures. No authorized live employer endpoint was fetched, no real inventory was fabricated, and no Chromium ingestion run is claimed.

Readiness remains **staging validation required**, not production ingestion certification. P1 prerequisites are an actually approved source, deployed persistent services, real PostgreSQL/multi-process recovery checks, and representative staging validation. Browser execution additionally requires a verified sandboxed browser worker; it stays disabled otherwise. Existing whole-platform legal, email/storage/scanner, payment sandbox and browser/accessibility prerequisites remain in force.

## Ingestion worker recovery hardening

A continuation audit repaired two confirmed recovery defects: a failed superseded worker could reschedule or dead-letter a source owned by its successor, and terminal crash recovery could leave an abandoned sync run marked as fetching/persisting. Task settlement now checks lease ownership before source updates; snapshot persistence checks the task lease token; failure accounting preserves source health when task ownership has changed. Recovery closes abandoned runs and clears expired source leases even when cancellation or exhausted attempts prevents another replay. Completed historical runs are retained.

Seven new migration-backed regressions cover both terminal outcomes, stale failures with and without source-lease replacement at different retry budgets, and a stale lease rejected before public persistence. The original four regression cases were also run against the previous implementation and all failed as expected before restoring the fixes.

Latest verification: `TEST_REDIS_URL=redis://127.0.0.1:6397 npm test` passed **177 tests across nine files**, including the real Redis/BullMQ lifecycle test. `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm run build` and `git diff --check` passed. There are no schema/environment changes in this recovery update. Database tests still use migrated PGlite, not independent PostgreSQL processes; no live source, browser execution, provider settlement or deployed performance result is claimed. The staging-only readiness verdict and outstanding launch prerequisites above remain unchanged.

## PostgreSQL contention audit and acceptance harness

The next audit identified inverted lock acquisition between source administration (source → task/run) and retry/recovery/failure settlement (task/run → source). These operations now acquire source locks first. Recovery selects and locks eligible sources with `SKIP LOCKED` before claiming their recoverable tasks. Cancellation retains its task-only lock so requests can interrupt fetching without waiting on a source transaction.

Added `tests/postgres.ts` and three independent-connection contention cases in `tests/integration/ingestion-postgres.test.ts`. The existing real Redis/BullMQ lifecycle test now uses PostgreSQL when `TEST_POSTGRES_URL` is supplied. The harness creates a unique disposable database, applies unchanged journaled migrations, and cleans up that database only; its test role requires `CREATEDB` and `pg_trgm` installation privileges. CI supplies the PostgreSQL and Redis URLs together. No application migration is required for this update.

Local verification: **177 tests passed, three PostgreSQL-only tests skipped**, across nine passing files and one skipped file. Real Redis/BullMQ scheduling, persistence into migrated PGlite, canonical full-text search, updates and confirmed closure passed. Type checking, lint, formatting, production build and diff whitespace checks passed. The new PostgreSQL pool path and contention cases were not executed locally because no standalone server is runnable in the authoring environment; configuration and test discovery are not evidence of a passing PostgreSQL run. Hosted CI remains separately subject to the account-level runner restriction. Production certification is still blocked by the previously listed P1 integration/staging prerequisites.

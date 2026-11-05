# Testing

## Local checks without infrastructure

```bash
npm ci
npm run typecheck
npm run lint
npm run format:check
npm test
npm run build
npm audit --omit=dev --audit-level=high
```

Tests use PGlite with the real PostgreSQL SQL migrations and `pg_trgm`. Coverage includes source normalization/import validation, safe URLs/HTML, schema/metadata/sitemap limits, tenant permissions, moderation/quota, saved jobs, native applications, privacy of notes, invitation identity, source outage/reconciliation/deduplication, payment mismatch/replay and rollback on an injected invoice failure. Authentication tests exercise the actual Better Auth handler, verification, reset and session resolution, with controlled email delivery. Auth-route rate limits are mocked for those tests; the production middleware is not bypassed.

PGlite serializes one engine's work. Its concurrent replay test proves unique transactional state under that harness, not a multi-host PostgreSQL load test.

`tests/integration/candidate-preferences.test.ts` uses real migrations and the actual platform route handler with controlled auth/email/rate-limit boundaries. It covers default-off history, explicit consent, deduplication, 50-entry/90-day limits, concurrent opt-out, account erasure, exports, cross-account edits/deletes, origin checks, alert changes, global email opt-out, in-app-only delivery, read/unread ownership, duplicate worker claims, provider failures, retry identity and crash-window review. External email and Redis behavior are not established by those mocks.

## Browser suite

Use an isolated database. Set `APP_ENV=test`, `DEMO_MODE=true`, `EMAIL_TRANSPORT=development`, a random test auth secret, `SITE_URL=http://localhost:3000`, and valid local database/Redis URLs.

```bash
npm run db:migrate
npm run db:seed
npm run build
# Terminal 1:
npm run start
# Terminal 2:
npm run worker
# Terminal 3, where browser installation is supported:
npx playwright install --with-deps chromium
npm run test:e2e
```

CI runs this topology automatically with PostgreSQL 17 and Redis 7.4. Desktop Chromium and a mobile viewport exercise public HTML/canonicals, search/pagination, mobile filters, saved jobs, alerts, native application confirmation, external destination transparency, employer drafts, administrator controls, denied anonymous access, registration/verification and password recovery.

The candidate preference browser scenario additionally enables/clears/disables history, selects in-app alerts, edits alert frequency and saved-search criteria, and marks a controlled notification as read. Test discovery is separate from browser execution; no passing browser result is claimed while the hosted runner is blocked.

These are explicit fictional test fixtures, never evidence of live vacancies. Production JobPosting behavior is separately covered with validated non-demo unit records. Provider outages/duplicates/payment rollback and malformed input are integration scenarios rather than browser tests.

## Additional release validation

- Test actual email sender/verification links and delivery retries in staging.
- Use Stripe/Paystack sandboxes for signed events, verification and refund variations.
- Upload benign and known test malware samples through a private scanner environment; never expose a public malware fixture.
- Run axe/manual keyboard/screen-reader checks and measure mobile LCP/INP/CLS on the deployed system.
- Load representative large inventory, use EXPLAIN/slow query logs and simulate worker termination/restart with persistent Redis.
- Validate genuine production URLs in Google's Rich Results Test/Search Console.

Do not report these external checks as passed until their execution is recorded in IMPLEMENTATION_REPORT. The managed authoring environment may lack an approved browser-control surface; in that case local browser execution is skipped and CI is the verification path, not a claimed screenshot review.

## Autonomous ingestion verification

`tests/unit/ingestion-adapters.test.ts` covers recorded JSON/XML/RSS/HTML parsing, Ashby fields, public/mapped/private IP rejection, mixed DNS answers, guarded redirects, robots, MIME/byte/request budgets, timeouts, pagination, malformed/duplicate records, unknown claims and browser gating. `tests/integration/ingestion-pipeline.test.ts` integrates approval, source tests, canonical persistence, generated full-text search, alerts, updates, closure, permission expiry, idempotency, ownership protection, quarantine, cancellation, retries and injected transactional failure. Recovery regressions cover stale worker failures before and after source-lease replacement, lease-token checks before persistence, and cleanup of abandoned sync runs when cancellation or exhausted retries prevent replay.

With `TEST_REDIS_URL` pointing to an isolated broker, `tests/integration/ingestion-queue.test.ts` runs real BullMQ scheduling/outbox delivery, worker stop/restart, canonical job updates, source identity reuse and confirmed closure into search. It uses a recorded source transport. Persistence uses migrated PGlite by default; setting `TEST_POSTGRES_URL` selects a real PostgreSQL pool for this same end-to-end lifecycle test. GitHub CI supplies both service URLs. Without the variable, the broker case is explicitly skipped.

Bash: `TEST_REDIS_URL=redis://localhost:6379 npm test`. Windows CMD: `set TEST_REDIS_URL=redis://localhost:6380`, then `npm test`. Do not point this suite at a production broker/database. The test uses a unique queue and removes only that queue. Browser scraping remains disabled until a permitted source and sandboxed browser worker have passed staging checks; the managed authoring environment did not execute Chromium.

## Independent PostgreSQL ingestion checks

Set both service URLs to enable the real PostgreSQL/BullMQ lifecycle and PostgreSQL lock-contention cases:

```bash
TEST_POSTGRES_URL=postgresql://careeratlas:careeratlas@localhost:5432/careeratlas TEST_REDIS_URL=redis://localhost:6379 npm test
```

For Windows CMD with local Docker ports 5433/6380, set `TEST_POSTGRES_URL=postgresql://careeratlas:careeratlas@localhost:5433/careeratlas` and `TEST_REDIS_URL=redis://localhost:6380` separately, then run `npm test`. Use the actual ports reported by `docker compose ps`.

The PostgreSQL test role needs `CREATEDB` and permission to install `pg_trgm` in its own test databases. The harness creates a unique `jobx_test_<uuid>` database per invocation, applies every journaled migration unchanged, uses an independent connection pool, and drops only that generated database on cleanup. It does not truncate tables in the connection URL's database. Never supply production database/broker credentials. An interrupted test process may leave a generated database; inspect its name and active connections before removing it manually.

`tests/integration/ingestion-postgres.test.ts` checks that manual retry waits on the source before locking a task, recovery skips locked sources without claiming their tasks, and failure handling waits on the source before locking a sync run. The tests use independent connections, `pg_stat_activity` wait events and `FOR UPDATE NOWAIT`; PGlite is intentionally not used to certify row-lock ordering. The three contention cases are explicitly skipped without `TEST_POSTGRES_URL`. These are same-server independent-connection checks, not a multi-host load or browser test.

The authoring environment did not run a standalone PostgreSQL server, so the PostgreSQL-only cases remain unverified locally. Do not infer a passing result from test discovery or CI configuration. Hosted execution must be confirmed separately; the account-level Actions runner restriction remains a blocker until resolved.

## Discovery audit acceptance

With both `TEST_POSTGRES_URL` and `TEST_REDIS_URL` set, `npm test` also runs:

- `discovery-postgres.test.ts`: independent PostgreSQL host pacing/cooldown reservations, review/employer race checks and stale-run cleanup.
- `discovery-workflow.test.ts`: recorded discovery, real admin route review/draft creation, source approval/testing, controlled ingestion, moderation and public full-text search; failed-seed retry and stale-worker fencing.
- `discovery-worker.test.ts`: actual persistent-worker startup, separate discovery dispatch, process crash/restart, heartbeat progress and stale-run recovery. It requires an isolated test broker with an empty `careeratlas` queue and no existing platform scheduler, and refuses an occupied queue. It removes its fixture queue/scheduler afterward. Do not run it against a deployed broker.

The full discovery workflow uses recorded transport responses; it is not a live employer/provider or browser certification. `tests/e2e/platform.spec.ts` separately covers linking a reviewed candidate to a verified employer and creating only a disabled pending source through the admin UI. The isolated CI test server trusts its controlled `x-real-ip` header so browser fixtures represent separate clients without weakening production authentication limits.

The November 5 audit recorded 234 passing unit/integration tests, zero skipped, on Node 22.21.1 with PostgreSQL 17.6 and Redis 7.4.2. Formatting, lint, typecheck and production build passed; migrations and seeding also passed locally. Four Playwright HTTP-only cases passed. Full browser execution remains blocked in the authoring environment by Unix-socket restrictions and must pass in hosted CI. See SOURCE_DISCOVERY_IMPLEMENTATION for the scope and remaining validation limits.

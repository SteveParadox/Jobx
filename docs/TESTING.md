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

These are explicit fictional test fixtures, never evidence of live vacancies. Production JobPosting behavior is separately covered with validated non-demo unit records. Provider outages/duplicates/payment rollback and malformed input are integration scenarios rather than browser tests.

## Additional release validation

- Test actual email sender/verification links and delivery retries in staging.
- Use Stripe/Paystack sandboxes for signed events, verification and refund variations.
- Upload benign and known test malware samples through a private scanner environment; never expose a public malware fixture.
- Run axe/manual keyboard/screen-reader checks and measure mobile LCP/INP/CLS on the deployed system.
- Load representative large inventory, use EXPLAIN/slow query logs and simulate worker termination/restart with persistent Redis.
- Validate genuine production URLs in Google's Rich Results Test/Search Console.

Do not report these external checks as passed until their execution is recorded in IMPLEMENTATION_REPORT. The managed authoring environment may lack an approved browser-control surface; in that case local browser execution is skipped and CI is the verification path, not a claimed screenshot review.

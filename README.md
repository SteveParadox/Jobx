# CareerAtlas / Jobx

A TypeScript job discovery and recruitment application built with Next.js App Router, PostgreSQL/Drizzle, Better Auth, Redis and a persistent BullMQ worker. Branding is configured through environment variables. This repository began with only its initial README; there was no existing application or data to migrate.

**Readiness:** implemented application for staging validation. Public production launch requires authorized inventory, provider credentials, completed operator/legal policies, live-provider sandbox verification and measured accessibility/performance checks. Read [the implementation report](docs/IMPLEMENTATION_REPORT.md) before launch. No genuine live job sources or payment accounts are claimed connected.

## Quick start

Requirements: Node 22.13+ (22 LTS recommended), npm, Docker Compose or accessible PostgreSQL 17 and Redis 7.4.

```bash
npm ci
cp .env.example .env
# Replace AUTH_SECRET with: openssl rand -base64 48
# Keep EMAIL_TRANSPORT=development for a private local inbox.
docker compose up -d
npm run db:migrate
npm run validate:env
npm run dev
```

In a separate terminal:

```bash
npm run worker
```

Open http://localhost:3000. The public catalog starts empty. To add a real employer, register at `/auth`, retrieve the local verification message, verify, sign in and open `/employers`:

```bash
npm run mailbox -- your-local-registration@example.com
npm run admin:grant -- your-verified-admin@example.com
```

The development inbox writes only to the local database. It never sends mail. Staging/production refuse this transport. Configure Resend and a verified sender there.

## Optional, explicit demo fixtures

Use a separate development database. Set `DEMO_MODE=true` and keep `APP_ENV=development`, then:

```bash
npm run db:seed
```

The command prints three fixture accounts and their deliberately public development password. Every company/job is marked fictional. Production startup rejects a database containing these demo accounts or employers. Do not reuse that database for production. Set `DEMO_MODE=false` for an empty catalog without fixtures.

## Working areas

| Area             | Routes / behavior                                                                                                                       |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Public discovery | `/`, `/jobs`, `/remote-jobs`, `/job/:uuid/:slug`, `/companies`, `/companies/:slug`                                                      |
| Candidate        | `/auth`, `/dashboard`: profile, saved jobs/searches, alerts, native applications, external tracking, private PDFs, export/erasure       |
| Employer         | `/employers`: organizations, drafts, preview, review submission, pause/close, applicants, internal notes, invitations, billing, metrics |
| Administration   | `/admin`: verification, moderation, source permissions/imports, reports, SEO, content, users, payments, quarantine, support, audit log  |
| SEO              | `/sitemap.xml`, `/sitemaps/:kind/:page.xml`, `/robots.txt`; eligible production job details only receive JobPosting                     |
| Operations       | `/api/health` for process liveness, `/api/ready` for database/Redis/fresh worker heartbeat                                              |

All privileged API operations enforce server-side authorization. Public browsing and external application destinations do not require registration. Account writes require verified email. Sources default disabled and need recorded display permission.

## Verification

```bash
npm run typecheck
npm run lint
npm run format:check
npm test
npm run build
npm audit --omit=dev --audit-level=high
```

Unit/integration tests run actual PostgreSQL SQL and migrations with PGlite, including `pg_trgm`. They do not require Docker. Browser tests use real PostgreSQL/Redis and explicit demo fixtures; see [TESTING.md](docs/TESTING.md). CI provisions those services, migrates, seeds, starts the web/worker and runs desktop/mobile Chromium tests.

## Documentation

- [Architecture](docs/ARCHITECTURE.md) · [Local development](docs/LOCAL_DEVELOPMENT.md)
- [Database](docs/DATABASE.md) · [Deployment](docs/DEPLOYMENT.md)
- [Job ingestion](docs/JOB_INGESTION.md) · [SEO](docs/SEO.md) · [Search](docs/SEARCH.md)
- [Authentication and permissions](docs/AUTH_AND_PERMISSIONS.md)
- [Employer workflows](docs/EMPLOYER_WORKFLOWS.md) · [Payments](docs/PAYMENTS.md)
- [Security](docs/SECURITY.md) · [Testing](docs/TESTING.md) · [Operations](docs/OPERATIONS.md)

## Deliberate boundaries

AI inference and résumé-to-AI processing are disabled. Recurring automatic payment charges, licensed third-party provider contracts, Search Console OAuth/reporting, cross-ATS application synchronization and labor-market salary statistics are not represented as live capabilities. Paid access uses verified **fixed paid periods** with expiry and manual renewal checkout. Featured results are labeled and retain ordinary relevance ordering.

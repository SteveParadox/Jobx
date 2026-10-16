# Architecture

## Runtime boundaries

The Next.js application renders public pages on the server and hosts request handlers. PostgreSQL is authoritative for identity, organizations, jobs, applications, payments and operational records. Redis supplies distributed request limits and BullMQ coordination. `src/worker/main.ts` runs on persistent compute; the web application does not perform lasting synchronization work in a serverless request.

A modular monolith keeps one schema and one domain implementation. UI components call `/api/platform/*`; these handlers validate bodies, enforce origin/session/tenant policies and call domain services. The route file dispatches resources, while business invariants live in `src/domain`. Better Auth mounts separately at `/api/auth/*`. Webhooks use raw-body provider signature verification.

## Principal modules

| Module                                              | Responsibility                                                                               |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `src/db/schema.ts`, `drizzle/`                      | Drizzle mappings, SQL migrations, constraints and search indexes                             |
| `src/domain/jobs.ts`                                | Publication lifecycle, organization ownership, quota enforcement, applications and audit     |
| `src/domain/ingestion.ts`                           | Permission checks, idempotent source snapshots, conservative aliases, closure reconciliation |
| `src/integrations/feeds.ts`, `imports.ts`           | ATS parsing; authorized upload parsing                                                       |
| `src/domain/search.ts`                              | Server-side full-text, trigram relevance and structured filtering                            |
| `src/domain/seo.ts`, `sitemaps.ts`                  | Metadata, eligibility, JSON-LD, canonical paths and sitemap membership                       |
| `src/domain/candidates.ts`, `notifications.ts`      | Candidate data, alert preferences, deduplication and email delivery                          |
| `src/domain/billing.ts`, `integrations/payments.ts` | Server-created attempts, authoritative provider verification and atomic settlement           |
| `src/integrations/storage.ts`                       | Private PDF storage, quarantine and authorized short-lived downloads                         |
| `src/domain/admin.ts`, `metrics.ts`                 | Operational views, source controls and measured activity                                     |

## Durable work

The minute scheduler queues source synchronization, email and eligible indexing tasks. Administrator manual imports and sync commands first enter the PostgreSQL `outbox`. Dispatch uses a stable BullMQ job ID, then acknowledges the outbox row. Indexing and email delivery also retain their own authoritative PostgreSQL state. Worker crashes before acknowledgement can replay safely. Configure Redis AOF, no-eviction and backups; neither a transient Redis instance nor serverless cron replaces this worker.

`src/integrations/sources/` owns the adapter contract, guarded transport, normalization, HTTP/HTML/RSS/XML/JSON/Ashby adapters, optional browser rendering and permitted application checks. `src/domain/source-management.ts` owns approval/revision boundaries. `src/domain/ingestion-tasks.ts` and `src/worker/ingestion.ts` coordinate durable schedules, leases, jittered retries, dead-letter review and queue dispatch. They persist into the same canonical jobs/search model.

## Concurrency and integrity

Publication serializes on the employer row before checking posting allowance. Candidate/job uniqueness rejects duplicate native submissions. Source/external IDs identify mappings; exact employer + normalized content + application destination can form a cross-source alias, while distinct source requisitions do not merge because of a shared careers URL. Payment settlement locks employer then checkout and writes transaction, receipt and access in one database transaction. Unique provider transaction IDs and attempt IDs enforce replay safety.

## UI

Server Components render public descriptions, metadata and listings. Client components handle forms, workspace actions, filter dialogs and optional analytics. The design uses green, cream and restrained warm accents; `SITE_NAME`, `SITE_URL` and `BRAND_COLOR` change the primary branding. Replace `public/icon.svg` for the app icon. Logos are intentionally not scraped or invented.

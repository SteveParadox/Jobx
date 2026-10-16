# Deployment

## Topology

Deploy Next.js to Vercel or the `web` Docker stage. Deploy the BullMQ worker to persistent compute using the `worker` Docker stage. Use managed PostgreSQL, persistent Redis (AOF/no-eviction), a private S3-compatible bucket and a configured email sender. Vercel does not host the persistent worker. `railway.worker.json` is supplied as a worker service configuration; verify its builder/target setting in the account before release.

## Configure environments

Use separate databases, Redis namespaces/instances, buckets and provider sandbox/live credentials for development, staging and production. `APP_ENV=staging` suppresses indexing even when `NODE_ENV=production` is used to run a built application. Do not use `DEMO_MODE=true` in a staging or production system containing real data.

| Variables                                                              | Requirement                                                                                   |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `SITE_NAME`, `SITE_URL`, `BRAND_COLOR`                                 | Branding, canonical origin and request-origin validation                                      |
| `DATABASE_URL`, `DATABASE_SSL`                                         | Database/pool endpoint; verified TLS for remote production databases                          |
| `REDIS_URL`, `AUTH_SECRET`                                             | Required core runtime; random secret of at least 32 characters                                |
| `EMAIL_TRANSPORT`, `RESEND_API_KEY`, `EMAIL_FROM`                      | Production requires `resend` and a verified sender                                            |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`                             | Optional Google sign-in; register the Better Auth callback URL                                |
| `S3_*`                                                                 | Private PDF storage and one-minute authorized downloads                                       |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`                           | Optional Stripe hosted checkout and signed webhook endpoint                                   |
| `PAYSTACK_SECRET_KEY`                                                  | Optional Paystack initiation, verification and signed events                                  |
| `GOOGLE_INDEXING_ENABLED`, `GOOGLE_CLIENT_EMAIL`, `GOOGLE_PRIVATE_KEY` | Optional authorized Indexing API; disabled by default                                         |
| `SOURCE_BROWSER_ENABLED`, `JOB_SOURCE_TOKEN_*`                         | Optional permitted browser worker and licensed-source secret references; browser defaults off |
| `ANALYTICS_ENABLED`                                                    | Optional consented product events; false by default                                           |
| `APP_ENV`, `DEMO_MODE`                                                 | Production uses `production` and `false`; never seed production                               |

Supply the correct domain/branding variables at build and runtime. Docker accepts non-secret `SITE_NAME`, `SITE_URL` and `BRAND_COLOR` build arguments for prerendered branding; pass the same values at runtime. The runtime proxy applies staging noindex or production HSTS independently of build-time environment. Next.js may prerender metadata and access pages. Set secrets through the platform secret manager. Do not put them in Git, build logs or Docker build arguments.

## Release procedure

1. Provision private database/Redis, bucket access policies and sender identity.
2. Review the operator entity, privacy notices, retention schedule, refund policy and applicable legal obligations. The included policy pages clearly identify unfinished operator details.
3. Back up the database; run migrations as a one-off release step.
4. Run `npm run validate:env` in the target environment.
5. Build using `npm ci && npm run build` or `docker build --target web -t careeratlas-web .`.
6. Deploy the web and `docker build --target worker -t careeratlas-worker .` worker separately.
7. Verify `/api/health` and `/api/ready`; confirm worker heartbeat and protected role access.
8. Register and verify the first operator, then use the operator-only `admin:grant` command.
9. Configure authorized sources, review imported records, and publish genuine vacancies.
10. Exercise email, storage, payment and indexing sandboxes; inspect logs and audit records.
11. Connect DNS/custom domain in the hosting account, validate TLS and verify canonicals.
12. Run browser/accessibility/load checks and only then enable production indexing.

Production rejects the example auth secret, development email transport, insecure origin, demo mode and a database with the known demo users/employers. Backups, least-privilege credentials and completed legal policies are still operator responsibilities; runtime checks do not certify compliance.

## Rollback

Roll back application images/commits first when the schema remains compatible. Do not run destructive down-migrations as an automatic rollback. If database recovery is needed, stop workers and writes, restore a verified backup into a new database, validate counts/relationships and replay only provider-verified unsettled payments. See OPERATIONS.

## Ingestion release and optional browser worker

Run migrations `0006_yellow_kylun.sql` and `0007_ingestion_guards.sql` before updating web/worker code. The latter backfills source ownership and deliberately disables legacy sources pending explicit endpoint/usage approval. It preserves jobs/provenance; reconfigure, approve, test and enable each actual source in Admin → Sources. Unjournaled duplicate migration artifacts were removed; previously journaled migrations are unchanged. Do not run obsolete SQL files manually.

Use the ordinary `worker` image for HTTP/ATS feeds. For an explicitly permitted JavaScript source, build `docker build --target worker-browser -t careeratlas-worker-browser .`, supply `SOURCE_BROWSER_ENABLED=true` only to the worker, and verify non-root Chromium sandbox support on the host. The web never needs browser execution. No source/merchant secret belongs in a build argument.

See [JOB_INGESTION](JOB_INGESTION.md) for exact configuration, source tests, scheduling, dead-letter recovery, link revalidation and the real-broker fixture test. Local broker integration was exercised separately from the still-required deployed PostgreSQL/load/browser checks.

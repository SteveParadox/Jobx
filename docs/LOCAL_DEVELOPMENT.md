# Local development

1. Install Node 22.13+, npm and Docker Compose.
2. Run `npm ci` and `cp .env.example .env`.
3. Generate a random `AUTH_SECRET`; set `SITE_URL=http://localhost:3000` exactly, without a path.
4. Start `docker compose up -d`; wait for both services to become healthy.
5. Run `npm run db:migrate` and `npm run validate:env`.
6. Start `npm run dev` and, in another terminal, `npm run worker`.
7. Register at `/auth`; inspect `npm run mailbox -- email@example.com`; open the verification link, then sign in.
8. Grant one verified local operator administrator access with `npm run admin:grant -- email@example.com`.
9. Create your organization in `/employers`, record verification evidence in `/admin`, create a draft and submit it for review.

Node scripts load `.env` with `--env-file-if-exists`. Next.js loads its supported environment files. Restart the web/worker after changing environment variables. Do not commit `.env`.

## Fixtures

`APP_ENV=development` or `test` and `DEMO_MODE=true` are both required for `npm run db:seed`. Fixtures have stable IDs and can be reseeded without duplicating them. Each vacancy explicitly says it is fictional. Fixture credentials are printed by the script, not provisioned in production. The seed does not connect a real ATS or send email.

## Common problems

- **Database refused:** check PostgreSQL health and `DATABASE_URL`; host tools use `localhost`, containers need the service hostname.
- **Origin rejected:** the browser address must equal `SITE_URL`. A different port, scheme or hostname is a different origin.
- **Verification mail absent:** development messages live in `development_emails`. Staging requires configured Resend delivery.
- **Job not public:** check employer verification, disabled flags, lifecycle, deadline and demo policy. Drafts do not have public detail pages.
- **No schema:** staging and fixtures intentionally omit active JobPosting; production also requires real original date and supported location fields.
- **Readiness 503:** start the persistent worker and check database and Redis connectivity. `/api/health` does not prove worker readiness.

To stop local services, use `docker compose down`. Do not remove named volumes unless you intentionally want to erase local data.

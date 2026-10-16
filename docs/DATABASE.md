# Database

PostgreSQL 17 is the deployment baseline. Drizzle supplies one set of schema mappings. Apply migrations with `npm run db:migrate`, using a migration account authorized to create tables, functions and `pg_trgm`. Application traffic should use a more restricted account after provisioning.

`0000` creates the original domain tables. `0001_search_constraints.sql` adds a generated weighted tsvector, GIN/trigram/array indexes, explicit lifecycle/role/salary/checkout constraints and the initial configurable plans. Later generated migrations add the development inbox and attachment policy. The custom SQL migration is deliberate; do not replace it with `drizzle-kit push` against production.

`0005_candidate_preferences.sql` adds candidate delivery/history settings, bounded search history with account/fingerprint uniqueness and retention indexes, and the first email-attempt timestamp. It is additive: existing alerts keep their per-alert consent, email delivery defaults to allowed for subscribed alerts, and search history defaults to off. Run migrations before starting the updated web and worker processes. Roll back application code without dropping these tables/columns; export any new data before considering a later removal migration.

## Domain groups

- Identity: users, accounts, sessions, verification records and candidate profiles.
- Organizations: employers, memberships, invitations and verification evidence.
- Jobs: records, source mappings, source runs, history, reports and ingestion errors.
- Candidates: saved jobs/searches, optional recent search history, delivery/history preferences, alert consent, private documents, applications and visible/internal events.
- Messaging: in-app notifications and delivery attempts with stable deduplication keys.
- Business: plan snapshots, checkout attempts, transactions, fixed-period subscriptions, invoices and placements.
- Operations: outbox, indexing notifications, audit logs, editorial content, settings, support, metrics and heartbeat.

UUIDs identify domain records. Better Auth owns its string identity IDs. Timestamps use timezone-aware PostgreSQL types. Source identity, candidate/job applications, provider transactions, invoices and settlement attempts have database uniqueness constraints. Résumé object keys never appear in public job selections.

Skills and eligibility countries use indexed arrays; candidate education and experience use validated JSON records. A dedicated taxonomy service is unnecessary for this release. Source data and unknown normalized fields remain separate.

## Migration discipline

```bash
npm run db:generate
npm test
npm run db:migrate
```

Review generated SQL before committing. Every schema change needs a forward migration and a backup/restore consideration. Never edit an already applied migration. The integration suite applies every journaled SQL file to a fresh engine and tests transactional rollback. It also exercises concurrency via one engine; genuine multi-process contention needs staging PostgreSQL load tests.

Keep backups encrypted and test restoring them into an isolated environment. Never restore a production database into an indexable development app. See OPERATIONS for recovery.

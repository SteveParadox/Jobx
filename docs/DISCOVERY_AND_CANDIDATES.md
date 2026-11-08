# Jobx broad-source discovery, source health, and optional candidate tools

This branch extends the federated search branch and is deliberately **not** restricted
to one country, job category, profile, or remote-work preference.

## Newly integrated source

SmartRecruiters public Posting API: `https://api.smartrecruiters.com/v1/companies/{company}/postings`
with `destination=PUBLIC`, offset pagination, and per-posting detail fetches.
The adapter uses only an operator-specified company token; every source still
requires verified employer identity, permission evidence, source approval,
a successful source test, and explicit enabling. Missing descriptions go to
quarantine. A remote workplace flag never becomes worldwide applicant eligibility.

Employer career pages, permitted JSON/XML/RSS/HTML/Playwright feeds,
Greenhouse, Lever, Ashby, licensed JSON endpoints and approved Apify actor
imports remain in the original source pipeline. Custom licensed data providers
must present access, attribution, storage and redistribution permission before
source registration. Public accessibility alone does not grant these rights.
No autonomous discovery run imports or publishes jobs.

## Source health and identity review

Migration `0012_discovery_observability` adds:
- `discovery_seed_health` with hashed seed identity, hostname, successes,
  failures, latest counts, and last observation/health status.
- `discovery_candidate_changes` with first-seen and identity-change events.

Scheduled and manual multi-seed runs reuse the existing bounded crawler,
approved-host transport, robots checks, PostgreSQL host pacing, and
discovery candidate review queue. A provider or board-token change marks an
identified candidate for **fresh review** and clears its reviewed identity
and employer association, unless it was explicitly rejected (rejections remain
in force). It does not change already approved source records automatically.
Operational observations older than 180 days are pruned; durable moderation audit
records remain separate. A temporarily missing link is **not** assumed to be
a revoked or closed job, because discovery crawls are intentionally bounded.

Admin → Discovery now exposes per-seed health and source-identity changes.
Approved sources continue to have their own independent ingestion health,
leases, retries, run history, failure counts, and source-owner revocation.

## Candidate experience

Migration `0013_external_lead_bookmarks` adds:
- `personalization_enabled` on candidate preferences, false by default.
  Candidate Dashboard → Privacy controls profile-based matching.
  Profiles are never sent to external search APIs by this feature.
- `external_saved_leads` owned and isolated by candidate account.
  Save requires a **15-minute signed token** tied to the current account,
  issued only from a trusted third-party result and only for an operator-authorized
  storage provider. Saved links cannot be posted arbitrarily by callers.
- Candidate Dashboard → External leads offers private bookmarks and explicitly
  **self-reported** application stages, separately from genuine native
  applications. Deletion, user-data exports, and provider revocation are supported.

The external lead provider retention allowlist is empty by default.
An operator can set `JOB_EXTERNAL_SAVE_PROVIDERS=usajobs,jooble` only after
verifying the provider-specific contract allows private copies, attribution,
retention and removal. Adzuna and Himalayas retention is disabled in this
implementation pending a compliant stored-result attribution/privacy experience.
A provider removed from the allowlist becomes invisible immediately, and the
worker deletes the stored copies at its next tick.

Existing candidate saved-search and email/in-app alert workflows remain
for the approved catalog. This implementation does **not** automatically
run paid external APIs on behalf of every saved search, as that would require
explicit quota controls, user consent and provider-approved retention/delivery
rights. External alerts remain a separate gated capability.

## Staging verification checklist

Before merging/deploying:
1. Back up and migrate a disposable PostgreSQL copy through `0013`.
2. `npm ci && npm run format:check && npm run typecheck && npm run lint`.
3. Run `npm test`, including the SmartRecruiters and external lead tests.
4. Run `npm run build`; smoke-test `/admin`, `/discover`, `/dashboard`,
   account deletion, data export, worker startup and scheduled discovery.
5. Test successful/empty/partial SmartRecruiters responses, 429/5xx, revoked
   source rights, malicious outbound URLs, altered provider identities and
   concurrent discovery runs using recorded fixtures and staging services.
6. Check the exact live provider contract, logo attribution and market quotas
   before enabling any provider key or retention allowlist.
7. Do not confuse authored tests with passing CI. This branch intentionally
   remains in draft pending executable test results and rollout approval.

Operator credentials, active source permissions and paid aggregator licenses
were **not** created or enabled by repository changes.


## Recurring authorized provider discovery

Migration `0014_external_provider_discovery` adds two **operator-only** tables:
`external_discovery_leads` (hashed source URL identity, content fingerprint,
original provider URL, operator query, first/last/changed timestamps, review
state and reviewer) and `external_discovery_runs` (bounded run history).
They are deliberately separate from published `jobs` and `job_sources`.

Configure `JOB_AUTONOMOUS_PROVIDER_DISCOVERY_ENABLED=true`,
`JOB_AUTONOMOUS_PROVIDER_DISCOVERY_INTERVAL_HOURS=24`, and
`JOB_AUTONOMOUS_PROVIDER_DISCOVERY_SEEDS` as an array of up to ten
operator-approved search descriptors, e.g.:

```json
[
  {"q":"accountant","provider":"jooble","location":"Lagos","market":"ng"},
  {"q":"public health","provider":"usajobs","location":"Boston","market":"us"}
]
```

Before enabling the schedule, separately configure the provider's API key,
market and quota rules, **and** enable `JOB_EXTERNAL_SAVE_PROVIDERS` only if
that provider's agreement explicitly allows storing these records. The
scheduler uses the same quota-limited connectors as `/discover`. It never
downloads personal candidate profiles or publishes jobs.

The BullMQ persistent worker runs searches no more often than the configured
interval (6–168 hours). Per-query results are bounded, content-fingerprinted,
deduplicated by provider and canonical link, and stored only as external
review leads. A changed reviewed lead returns to pending; rejected leads
remain rejected. If source rights are revoked in configuration, the next
worker tick purges retained records for that provider.

Admin → External discovery displays run health, keyword provenance, source
links, content-change times, and review controls. Reviewing a lead is
**not** authorization to redistribute the listing or create an employer.
To publish, the employer must be independently verified and an approved
source must still pass Jobx's normal import/review pipeline.

The periodic worker cannot be replaced by a short-lived Vercel request.
An empty database or absent credentials generates no pretend vacancies.

## Additional employer-authorized ATS feeds

The `smartrecruiters` source adapter is built in and recognized by source
discovery. Its company token yields an exact official public Posting API
endpoint; full posting details are required before any normalized job passes
review.

The existing `licensed_json` provider can now authenticate a Recruitee
Careers Site API using `credentialMode: "recruitee_careers"` and a
`JOB_SOURCE_TOKEN_...` environment variable. Credentials are sent only as
`X-Careers-Sites-Token` to the **operator-approved, fixed HTTPS host**.
For example, the employer-authorized endpoint is
`https://example.recruitee.com/api/offers/`, with an operator-reviewed
`recordsPath` and explicit field mapping reflecting real provider responses.
The token must be issued by that employer. This does not assume every Recruitee
site grants public redistribution rights, and it does not enable unauthenticated
candidate submission. Provider docs announce mandatory token headers beginning
February 10, 2027.

Workable's private SPI/v3 jobs API requires an employer account token with
`r_jobs` scope. Its existing bearer token flow is supported through
`licensed_json` for authorized JSON documents, but a full posting adapter
must check `state="published"` and retrieve complete job details before
approving such records. Never import non-public roles by default.

## Candidate alerts and filtering

Candidate Dashboard → Privacy explicitly enables or disables profile-based
matching. The Jobx published catalog already supports voluntary saved searches,
daily/weekly email and in-app alerts, as well as job application tracking.
The federated search UI now exposes **Jobx-only** optional employment, remote
applicant country, posting age, and sort filters. Unsupported provider filters
must not be silently reported as applied.

External paid API alerts are **not** automatically turned on for all users.
Those require a separate provider-specific delivery license, consent, lifetime
quota policy, and unsubscribe/retention audit, rather than reusing the public
catalog's alert subscriptions without permission.

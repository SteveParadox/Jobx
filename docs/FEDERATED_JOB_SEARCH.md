# Federated job discovery: source integrations and operator controls

This feature is an **industry-neutral, geography-neutral, profile-independent**
authenticated search surface at `/discover`. It never searches only one profession
or country by default. It combines Jobx's approved public catalog with optional,
credentialed partner APIs in a transient result list. It does not deploy ChatGPT
search infrastructure or claim access to every commercial job board.

## Supported sources

| Source | Integration | Live by default | Publication behavior |
| --- | --- | --- | --- |
| Jobx published catalog | PostgreSQL search, canonical source approval | Yes, if a database and approved active jobs exist | Already moderated, eligible public listings only |
| Greenhouse | Official board endpoint via existing ingestion | No | Employer/source permission, test, enable, moderate |
| Lever (global + EU) | Official board API via existing ingestion | No | Same approved-source pipeline |
| Ashby | Public postings API via existing ingestion | No | Listed postings only; approved-source pipeline |
| Custom JSON, XML, RSS/Atom | Authorized feed adapters | No | Scope, redistribution, field and robots policy |
| HTML + optional browser | Approved employer career pages | No | Robots, fixed-host transport, browser approval |
| Licensed JSON adapters | Reviewed trusted code + licensed endpoint | No | Credentials only in secrets and source approval |
| Apify actor/dataset | Existing approved per-employer actor import | No | `manual_apify` ownership, source leases, refresh, moderation |
| Adzuna | Credentialed national job search APIs | No | **External lead only**, never auto-imports |
| USAJOBS | Official federal vacancy search API | No | **External lead only**, never auto-imports |
| Jooble | Country-specific authorized REST API | No | **External lead only**, never auto-imports |

There is no blanket technical or legal integration for all job sites.
LinkedIn, Indeed, other closed boards, private ATS feeds, and unlicensed provider
data are not crawled through unauthorized methods. Add them only through a
provider-permitted API/partnership or an employer-authorized feed. Remotive's free
API has special limits on third-party submissions, attribution and signup gates;
do not connect it as a generic bulk publishing source without reviewing its terms.

## Use

1. Sign in, navigate to `/discover` and enter **any** job title or keywords.
2. Optionally enter an external-provider location and select a national API market.
   When no market is selected, configured Adzuna markets (max two per request),
   USAJOBS if enabled, and Jooble's configured region can participate.
3. Choose all or one provider. Remote-only requests use only providers with a
   confirmed filter: Jobx and USAJOBS. Adzuna and Jooble explicitly report skipped.
4. Results link directly to the published Jobx detail or the original partner.
   External leads are marked not independently verified; no visa/work eligibility,
   compensation, freshness or application outcome is inferred.
5. For structured catalog filters, saved searches, and opt-in email alerts, use
   `/jobs` and the existing candidate dashboard instead. External results are
   *not* automatically persisted into those alerts or the public SEO catalog.

The optional `country` API parameter filters the existing Jobx catalog by
the listing's country. The `location` text field is passed only to external
providers; the internal Jobx catalog has separate structured location filters at
`/jobs`. An API market denotes a provider's national catalog, not a person's
eligibility to work there.

## Provider secrets and enablement

All these variables are **server-side only** and default to disabled.

### Adzuna

- Obtain your own app ID/key and any required permissions via
  https://developer.adzuna.com/.
- Review current display, commercial, attribution and quota terms. The operator
  must provide the **official** logo and attribution, not an invented brand mark.
- Set `FEDERATED_ADZUNA_ENABLED=true`,
  `FEDERATED_ADZUNA_APP_ID`, `FEDERATED_ADZUNA_APP_KEY`,
  `FEDERATED_ADZUNA_MARKETS=gb,us,ca` (choose authorized market codes), and
  `FEDERATED_ADZUNA_ATTRIBUTION_LOGO_URL=/images/adzuna-official-logo.png`.
- **The logo file is not bundled.** Obtain authorized artwork yourself and
  place it in the application's `public/images/` directory at the configured
  path. Remote logo URLs are deliberately disallowed; verify the official logo
  and attribution in a real browser before enabling display. Results include a linked "Jobs by" plus linked official image
  at no smaller than 116×23 CSS pixels. Never enable with a missing/incorrect logo.
- National API markets supported by the adapter: us, gb, au, ca, de, fr, nl, be,
  at, ch, it, es, pl, in, sg, nz, za, br and mx. Other countries do not map to
  an Adzuna marketplace. No country's market is silently chosen for all users.
- The service caps automatic multi-market queries at two markets per search,
  with at most 90 authenticated provider calls per day globally; note each
  two-market search can consume two upstream API requests.

### USAJOBS

- Request an API token at https://developer.usajobs.gov/apirequest/index.
- Set `FEDERATED_USAJOBS_ENABLED=true`, `FEDERATED_USAJOBS_API_KEY`,
  and `FEDERATED_USAJOBS_EMAIL` to the email registered with the API.
- Requests use fixed HTTPS `data.usajobs.gov/api/search` with the documented
  `Authorization-Key` and registered `User-Agent`. Remote-only is supported
  using `RemoteIndicator=True`. The service restricts daily requests to 300.
- These are U.S. federal announcements. A vacancy being publicly accessible does
  *not* mean all users have citizenship or work authorization eligibility.

### Jooble

- Obtain the correct national-domain REST API key at
  https://jooble.org/api/about (or the local country domain).
- Set `FEDERATED_JOOBLE_ENABLED=true`, `FEDERATED_JOOBLE_API_KEY`,
  and `FEDERATED_JOOBLE_REGION` to the region for **that key** (e.g. `ng`,
  `us`, `uk`). The UK Jooble domain uses `uk.jooble.org`;
  UI market selection uses `gb`, so the connector translates that match.
- Jooble requires a location; if one is not supplied the provider reports skipped
  rather than inventing a default location. Use explicit provider attribution.
- The free API documentation warns of a 500-request *lifetime* key allowance:
  a Redis 10/day cap does not replace operator-side total-lifetime accounting.
  Obtain a commercial plan before scaling.

## Trust and security boundaries

- The route requires an authenticated Jobx session, with per-account limits of
  four searches per minute; upstream providers also have distributed, hashed-key
  global Redis budgets. Redis must be configured in production.
- No user profile, CV, skills, account identifier, search history, or email is
  shared with partners. The external request contains the user-entered search
  keywords and location. USAJOBS gets the *operator's* registered API email.
- HTTP requests go only to fixed official HTTPS API hosts, with no redirects,
  eight-second deadlines, strict JSON parsing and 1.8 MB response-body caps.
  Provider credentials never appear in public API responses or rendered pages.
- Display links are restricted to source-provider HTTPS domains. Never fetch
  those returned links from the server or use them as ingestion authority.
- If a provider fails, its status is reported and other sources still work.
  No empty/failing provider is represented as "zero jobs exist".
- API content is ephemeral and is **not indexed, cached in user search history,
  inserted into Jobx jobs, or automatically re-distributed**. Contract-specific
  retention and removal requirements must be reviewed before any future storage.
- Jobx approval, employer verification, source-owner mappings, moderation,
  revocation, job freshness and SEO gates are unchanged.

## Apify bias removed

The default actor input no longer hardcodes a Nigeria country filter or a
specific shortlist of professional titles. It retains a bounded 24-hour window
and a 100-item per-run limit, and operators can supply explicit actor-approved
search parameters through `APIFY_INPUT`. Verify that the configured actor
accepts this input shape in staging. The importer still requires a separately
approved and enabled per-employer `manual_apify` source; it does not auto-approve
or publish new employer records.

## Verification and rollout

On a clean branch checkout, with Node 22 and isolated test services:

```bash
npm ci
npm run format:check
npm run typecheck
npm run lint
npm run test -- tests/unit/federated-providers.test.ts tests/integration/federated-search.test.ts
npm run test
npm run build
```

Then test preview/staging with a permitted test key for **each** provider:
validate success, 401/403, 429/5xx, timeout, oversized payload, invalid JSON,
malicious URL, missing attribution, multiple markets, disabled source and user
session/rate limiting; measure quota consumption and response times. Perform
browser checks (desktop/mobile) for an accessible form, truthful source labels,
link security and required brand attribution.

**No API keys, provider licenses, staged acceptance runs, active live sources,
successfully running GitHub Actions jobs, or completed production deployments
are claimed by the code alone.** Keep the PR in draft until verification completes.

## Expansion roadmap

- Add provider-level secrets, legal permission records, license expiry and usage
  counters in PostgreSQL, with global budget monitoring.
- Use a plugin registry to add additional official/licensed job APIs without
  modifying the frontend or approval pipeline. Avoid arbitrary user-entered
  API URLs and unguarded scraping.
- Build a separate rights-aware background search/discovery queue with
  scheduled searches, deduplicated per-source identities, provenance, last-seen
  states, removal/webhook handling and an operator review inbox.
- Add a distinct private external-lead watchlist only when provider terms permit
  storage and with consent, retention, export and deletion.
- Extend search UX with pagination per provider, country-specific market
  selectors, filters mapped only when supported by each API, resilient caching
  within license terms and explicit coverage/status explanations.
- Keep Jobx published catalog independent, so external lead outages or provider
  license revocation cannot silently corrupt public listings.

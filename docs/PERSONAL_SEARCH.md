# Personal job search

Jobx includes an authenticated, on-demand **Personal job search** panel in Dashboard → Overview.

## Current behavior

- Uses the candidate's private profile headline, explicitly entered skills, and country for role discovery and geographic screening.
- Allows a role keyword, remote-only toggle, and an option to show postings with uncertain location eligibility.
- Performs up to five bounded searches against Jobx's existing publicly visible catalog. Search visibility rules still require active, unexpired jobs, verified and enabled employers, and approved current source permissions where applicable.
- Deduplicates returned jobs, computes transparent skill-overlap hints, and shows employer, location, source-check date, and carefully qualified geographic labels.
- Excludes remote roles whose **explicit** restricted applicant-country list omits the profile country. Unknown eligibility remains clearly marked and can be hidden. Local workplace geography is **not** a determination of legal work authorization.
- Never stores an implicit search history, sends a profile to an external service, collects a resume, starts a crawl, imports jobs, publishes a listing, or applies on behalf of the candidate.
- Uses the existing job-detail page for verified application links and existing Save job, saved searches, optional alerts, and externally self-tracked applications.

## How to use

1. Sign in with a verified account, open /dashboard, and add skills, a headline, and a two-letter country code in Profile.
2. In Overview → Personal job search, search by role or use your profile skills.
3. Select remote-only and whether to see listings where the eligible countries are not confirmed.
4. Open a result, inspect its actual requirements and original application destination, save it, and apply manually.
5. Create a separate explicit saved search/alert in Alerts & searches for future matching **published** jobs.

## Boundaries and next steps

**This is not live internet-wide job search.** It can only return jobs Jobx already stores and is allowed to publish. An empty catalog produces no external jobs. ChatGPT's hosted browsing/search connectors cannot be embedded in a standalone app.

An internet-wide personal lead inbox would require a separate licensed or permission-compliant discovery provider, external verification workflow, private per-user storage, deduplication, removal rights, authenticated ownership checks, abuse limits, and explicit consent. Do not route scraped unapproved leads into published jobs. Only add provider integrations after reviewing actual source access and display terms.

The current matching strength is a keyword/skill heuristic, **not** an AI model, fit percentage, hiring prediction, proof of an opening being available, or proof of immigration/work eligibility. Verified source controls do not guarantee employer pages remain active between checks.

## Verification

Unit tests cover country exclusion, uncertain eligibility, local workplace caveats, and bounded skill matching. Integration tests exercise published inventory, cross-account isolation, and absence of implicit history/imports. Run:

```bash
npm ci
npm run db:migrate
npm run typecheck
npm run lint
npm run format:check
npm run test -- tests/unit/personal-search.test.ts tests/integration/personal-search.test.ts
npm run build
```

A complete acceptance run additionally verifies logged-out rejection and country/skill changes through the dashboard, real source approvals, working application links, and an opt-in alert. No live provider coverage or browser-test success is implied by the new test definitions.

# Permission-aware source discovery

## Current scope

The discovery worker accepts a bounded list of operator-supplied HTTPS seed URLs and performs limited career-page discovery. It recognizes Greenhouse, Lever (US/EU), and Ashby board patterns, checks the seed host's `robots.txt`, inspects a small number of same-host career pages and sitemaps, deduplicates candidates, and records evidence and run history.

Network access is constrained: HTTPS only, public DNS answers only, the validated IP is pinned for the socket connection, cross-host redirects are rejected, and requests have byte, time, redirect, page, sitemap, and candidate limits. External ATS URLs found on a career page are recorded as candidates but are not fetched as part of that host's crawl. Robots policy is checked before crawling career pages and sitemaps.

Candidates appear in **Admin → Discovery**. An administrator can mark a candidate as identified, keep it in review, or reject it with a required note. Human review state is preserved across later scans.

## Enable scheduled discovery

Set these environment variables for the persistent worker and web service:

```dotenv
JOB_DISCOVERY_ENABLED=true
JOB_DISCOVERY_SEEDS=https://example.com/careers,https://jobs.ashbyhq.com/example
JOB_DISCOVERY_INTERVAL_MINUTES=60
```

The seed list accepts newline, comma, or semicolon separators. At most 25 unique seeds are accepted per run and at most 1,000 candidates are processed per run. Runs that remain marked running beyond 30 minutes are marked failed so they cannot block future scans indefinitely. Each seed crawl is bounded to a small number of pages and sitemaps. The interval must be between 15 minutes and 7 days. Discovery is disabled by default.

Run the normal database migration command after deploying the code:

```sh
npm run db:migrate
```

This adds the `discovery_candidates` and `discovery_runs` tables. It does not change existing source approval or publication behavior.

## Review and source draft workflow

1. Run discovery manually in Admin → Discovery, or enable the scheduled worker.
2. Inspect candidate URL, detected ATS provider, board token, and recorded evidence.
3. Save a review note and choose identified, review-required, or rejected.
4. For an identified supported ATS candidate, use **Create disabled source draft** only after verifying the employer and documenting explicit permission for the intended access, storage, attribution, display, and redistribution.
5. The employer must already have a verified status. The source draft is created disabled with approval pending; it cannot ingest or publish.
6. Finish the normal source approval process, confirm permitted fields, application hostnames, usage conditions, removal policy and any authorization expiry. Run a source test before enabling scheduled ingestion.
7. Job moderation/publication remains a separate decision.

**A publicly reachable URL is not proof of permission to scrape, store, or republish its content.** Candidate review and draft creation do not grant that permission.

## Security boundaries and limitations

- Discovery does not create employer records or mark employers as verified.
- Public DNS answers are checked and the chosen address is pinned for each HTTPS request. All returned DNS answers must be public unicast addresses.
- Redirects must remain on the original host. The crawler does not fetch external ATS pages while crawling employer domains.
- Requests have a 6-second timeout and 1 MB response limit; each seed is limited to a small number of pages and sitemaps. A run is limited to 1,000 persisted candidates.
- A crawl that cannot safely check `robots.txt` is rejected rather than proceeding blindly.
- The crawler does not extract job listings or publish records. Actual ingestion continues through the existing source adapter, permission approval, source test, ingestion task, and moderation paths.
- Discovery is not a substitute for verifying source permissions, provider terms, data retention rules, or employer identity.

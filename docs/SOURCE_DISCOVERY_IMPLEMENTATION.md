# Permission-aware source discovery

## Current scope

The discovery worker accepts a bounded list of operator-supplied HTTPS seed URLs. It canonicalizes URLs, recognizes Greenhouse, Lever (US/EU), and Ashby board URL patterns, deduplicates candidates, and records evidence and run history. It does not yet crawl arbitrary career sites, fetch sitemaps, or scrape job listings.

Candidates appear in **Admin → Discovery**. An administrator can mark a candidate as identified, keep it in review, or reject it with a required note. Human review state is preserved across subsequent scans. Candidate review is not source approval.

## Enable scheduled discovery

Set these environment variables for the persistent worker and web service:

```dotenv
JOB_DISCOVERY_ENABLED=true
JOB_DISCOVERY_SEEDS=https://example.com/careers,https://jobs.ashbyhq.com/example
JOB_DISCOVERY_INTERVAL_MINUTES=60
```

The seed list accepts newline, comma, or semicolon separators. At most 200 unique seeds are processed per run. The interval must be between 15 minutes and 7 days. Discovery is disabled by default.

Run the normal database migration command after deploying the code:

```sh
npm run db:migrate
```

This adds the `discovery_candidates` and `discovery_runs` tables. It does not change existing source approval or publication behavior.

## Review and onboarding workflow

1. Run discovery manually in Admin → Discovery, or enable the scheduled worker.
2. Inspect candidate URL, detected ATS provider, board token, and recorded evidence.
3. Save a review note and choose identified, review-required, or rejected.
4. For an identified candidate, verify the employer and obtain evidence that explicitly permits the intended access, storage, attribution, display, and redistribution.
5. Register the source in Admin → Sources. It is created disabled and pending approval.
6. Complete the permitted fields, application hostnames, usage conditions, removal policy, and any authorization expiry.
7. Approve the source only after the employer is verified and the actual permission scope is documented. Run a source test before enabling scheduled ingestion.
8. Job moderation/publication remains a separate decision.

**A publicly reachable URL is not proof of permission to scrape, store, or republish its content.** Discovery candidates cannot be enabled or published directly.

## Security boundaries and current limitations

- Only HTTPS URLs with public-looking DNS hostnames and standard HTTPS ports are accepted by the seed classifier.
- Candidate discovery does not perform network requests, follow redirects, or fetch robots.txt. These controls must be implemented with DNS/IP pinning and redirect validation before network-backed crawling is introduced.
- No discovered candidate is automatically registered as an approved source.
- The current manual run endpoint bypasses the scheduled interval but still uses the same 200-seed cap and URL validation.
- Use the existing source registry and ingestion pipeline; do not create a parallel scraper or publication path.

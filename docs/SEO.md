# Technical SEO

## Indexability policy

Public descriptions and search results are rendered as server HTML. Jobs use `/job/:uuid/:current-slug`; obsolete slugs permanently redirect to the current canonical path. Search/filter/sort pages and account/admin pages use explicit noindex metadata. Staging, test and development also send `X-Robots-Tag: noindex, nofollow` across all routes. Robots exclusions complement these directives and are not the sole protection.

Curated `/jobs/...` pages are administrator-authored settings, not generated permutations. They require editorial approval, meaningful distinct guidance and at least three matching active records. They return 404 and leave the sitemap if the threshold is not met. No hreflang is emitted because this release does not contain genuine translated alternatives.

## JobPosting

Only an active, non-demo production detail record with a real original date, substantive description, employer identity and validated location/eligibility receives JobPosting. Salary is emitted only from disclosed values with currency/period. Fully remote jobs use `TELECOMMUTE` plus explicit applicant countries. Hybrid jobs retain physical location semantics. `directApply` is omitted rather than claimed for an unproven flow. All source descriptions are sanitized, and JSON-LD escapes script terminators.

Expired jobs leave active search immediately on deadline checks, even if the minute worker has not changed their stored lifecycle yet. Archived closed/expired detail pages are useful, clearly closed, noindex and lack active JobPosting. Paused/draft records do not have public detail pages. Expiration/publication/edits/verification changes create deduplicated indexing notifications.

## Sitemaps

`/sitemap.xml` indexes separate job, company, editorial, curated landing and supporting-page files. Each generated file uses at most 10,000 URLs, below the 50,000-URL limit, and enforces the 50 MB uncompressed bound. Only canonical, eligible members are included. Jobs use material update timestamps; verification-only polling does not change job lastmod. Built-in editorial/support pages use their real content creation date, not the current request time.

```bash
curl -fsS https://your-domain.example/sitemap.xml
curl -fsS https://your-domain.example/sitemaps/jobs/0.xml
```

Production sitemaps contain no demo roles. Non-production sitemaps are empty. Source/provider permission and employer verification still govern eligibility.

## Google validation and submission

1. Verify the actual domain in Google Search Console using a permitted DNS/HTML verification method.
2. Submit the sitemap index through Search Console; inspect URL/canonical coverage.
3. Open a real active job URL in https://search.google.com/test/rich-results and inspect both detected data and rendered HTML.
4. Repeat with a remote role and a closed role. A closed page must not show active JobPosting.
5. Confirm that visible salary/location/date fields match markup exactly.

The optional Indexing API uses a service-account JWT and the official OAuth scope, and is disabled without configuration. Grant the service account authorized Search Console ownership, enable the API and set `GOOGLE_INDEXING_ENABLED=true`. Only job detail URLs enter this queue. The worker caps dispatch, retries errors with exponential backoff and retains results. Adjust the deployment's quotas to the actual authorized Google quota; the default work rate is intentionally conservative. An accepted notification is not guaranteed indexing or a ranking promise.

References: https://developers.google.com/search/docs/appearance/structured-data/job-posting and https://developers.google.com/search/apis/indexing-api/v3/quickstart

## Monitoring limits

Admin → SEO reports eligible/invalid sampled records, expired lifecycle backlog, canonical policy and configuration. Search Console OAuth and organic performance data are explicitly not connected. Automatic crawler-wide broken-link and duplicate-content auditing remains a staging enhancement; no invented health score is shown.

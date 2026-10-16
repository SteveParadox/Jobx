# Search

`src/domain/search.ts` defines the search boundary. PostgreSQL performs filtering and pagination; the browser never receives the complete catalog.

A generated weighted English tsvector indexes titles (A), explicit skills (B) and description text (C). `websearch_to_tsquery` supports phrase queries. Trigram similarity supplies title typo tolerance. A small explicit synonym map normalizes JS/TS, Node.js, PostgreSQL and front/back-end terminology. Employer-name matching, structured location, workplace, remote eligibility, company, category, industry, education, seniority, employment type, experience, posting age and sponsorship filters are supported.

Relevance combines text rank, title similarity, recency and recent verification. Recency and salary sorting are separate explicit options. Salary sorting/filtering requires both the same currency and salary period; no exchange-rate assumption is made. Null salary/sponsorship values never become invented facts. Featured placements receive a label and do not secretly change ordering.

City/region/category/industry comparisons are case insensitive, and country codes normalize to uppercase. Functional location/industry indexes support these comparisons. Parameters live in the URL, survive pagination and are schema validated. The page size is 20, query length is 160 and page numbers are bounded to 1,000. Query/lock timeouts and distributed request limits reduce abusive cost. Filters with empty values are removed before parsing. The mobile filter dialog uses Radix focus management.

The initial adapter is PostgreSQL. An external search engine can replace the `searchJobs`/suggestions boundary while preserving visibility rules, authorization and query semantics. This release does not claim multilingual morphology or general semantic/AI search.

Use `EXPLAIN (ANALYZE, BUFFERS)` against representative staging inventory before tuning indexes. Small fixture tests confirm behavior, not production latency or Core Web Vitals.

## Saved searches and optional history

Candidates can edit saved-search names and validated criteria in Dashboard → Alerts & searches. Stored searches start on page one. Saved searches are separate from automatic history and remain when history is disabled.

Search history requires an explicit account opt-in in Dashboard → Privacy. A client POST after rendering a valid first results page records only authenticated, verified accounts whose current preference permits it. Anonymous searches, default unfiltered searches and pagination do not create history. Recording does not block public results. No anonymous identifier or third-party history service is used.

The database deduplicates search criteria across paging, sorting, property order and case, keeps at most 50 entries per account, and hides records older than 90 days. The persistent worker deletes expired entries. Candidates can remove one entry, clear history, or disable it to erase all entries. Account deletion also removes history/preferences; exports include retained history. Concurrent recording and preference changes serialize on the account row so an in-flight request cannot restore history after opt-out. These controls do not replace the operator's privacy/legal review.

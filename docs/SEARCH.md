# Search

`src/domain/search.ts` defines the search boundary. PostgreSQL performs filtering and pagination; the browser never receives the complete catalog.

A generated weighted English tsvector indexes titles (A), explicit skills (B) and description text (C). `websearch_to_tsquery` supports phrase queries. Trigram similarity supplies title typo tolerance. A small explicit synonym map normalizes JS/TS, Node.js, PostgreSQL and front/back-end terminology. Employer-name matching, structured location, workplace, remote eligibility, company, category, industry, education, seniority, employment type, experience, posting age and sponsorship filters are supported.

Relevance combines text rank, title similarity, recency and recent verification. Recency and salary sorting are separate explicit options. Salary sorting/filtering requires both the same currency and salary period; no exchange-rate assumption is made. Null salary/sponsorship values never become invented facts. Featured placements receive a label and do not secretly change ordering.

Parameters live in the URL, survive pagination and are schema validated. The page size is 20, query length is 160 and page numbers are bounded to 1,000. Query/lock timeouts and distributed request limits reduce abusive cost. Filters with empty values are removed before parsing. The mobile filter dialog uses Radix focus management.

The initial adapter is PostgreSQL. An external search engine can replace the `searchJobs`/suggestions boundary while preserving visibility rules, authorization and query semantics. This release does not claim multilingual morphology or general semantic/AI search.

Use `EXPLAIN (ANALYZE, BUFFERS)` against representative staging inventory before tuning indexes. Small fixture tests confirm behavior, not production latency or Core Web Vitals.

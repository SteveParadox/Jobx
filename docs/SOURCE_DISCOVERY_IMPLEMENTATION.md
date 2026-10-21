# Job source discovery implementation

## Current implementation slice

`src/domain/discovery/source-classifier.ts` provides deterministic primitives for safe candidate URL canonicalization, exact-host ATS pattern detection, same-host link resolution, and idempotent evidence merging. The tests in `tests/domain/discovery.test.ts` cover supported ATS URL patterns, lookalike-host rejection, unsafe URL rejection, and permission-state defaults.

This layer deliberately does **not** fetch candidate URLs, create employers, register `job_sources`, or grant redistribution rights. A detected ATS URL is evidence of a provider pattern, not evidence that the operator may republish its listings.

## Authorization boundary

Every discovered candidate sets `requiresPermissionReview: true`. Integrations must route candidates through the existing administrator-controlled source registration and `sourceApproved` checks before any source sync. Do not enable auto-publication based on public accessibility alone. Keep credentials out of URLs and logs.

## Next integration requirements

The remaining end-to-end work is to persist candidates and discovery runs in PostgreSQL, schedule bounded discovery from the persistent worker, add authenticated review APIs and Admin UI, and test the full fixture flow through the existing ingestion task/outbox system. Until those pieces are implemented and validated, this primitive layer alone is not a complete autonomous discovery service.

## Safe integration contract

- Accept configured seeds and employer-provided career URLs only.
- Canonicalize HTTPS URLs and reject credential-bearing, IP-literal, localhost, and non-standard-port targets.
- Resolve links only within the registered host unless an external ATS candidate is explicitly surfaced for review.
- Use DNS/IP and redirect validation immediately before network requests; URL syntax checks alone do not prevent SSRF or DNS rebinding.
- Bound candidate counts, sitemap depth, page size, response bytes, timeouts, and per-host concurrency.
- Keep candidate evidence, employer identity evidence, source permission evidence, and publication permission separate.
- Treat robots directives, provider terms, explicit authorization and redistribution rights as independent policy inputs.

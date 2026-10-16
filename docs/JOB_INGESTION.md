# Authorized ingestion

## Implemented adapters

Greenhouse Job Board API, Lever global/EU Postings API and administrator-uploaded JSON, CSV and XML complete snapshots are implemented. They are not enabled for any real employer by default. Public reachability is not redistribution permission.

Official references checked during implementation:

- https://docs.greenhouse.io/job-board
- https://github.com/lever/postings-api

The ATS adapter uses only fixed provider hosts and a validated board identifier. Redirects are rejected, requests time out after 20 seconds, response bodies are bounded to 10 MB and Lever pagination must complete within its safety cap. XML uploads reject DTD/entity declarations. Upload imports are limited to 180 KB and 1,000 records.

## Add a source

1. Obtain employer/provider permission for redistribution and retain the authorization reference.
2. Create the real employer, with its official website; complete verification.
3. Open Admin → Sources and select the provider or manual format.
4. Record permission evidence covering all fields, attribution, removal obligations and a minimum 15-minute fetch interval.
5. The new source starts disabled. Enable it only after checking permissions.
6. Queue synchronization for ATS sources. For manual sources, upload the **complete** authorized snapshot using the import form and matching format.
7. Inspect the run and errors, then review pending jobs and confirm unknown structured details.
8. Publish only accurate records. Source listings are moderated; unknown ATS location labels are never treated as country/remote eligibility evidence.

## Snapshot flow

Fetch/parse → validate every record → sanitize/normalize → resolve source identity/aliases → persist pending records → administrator review → publish/search → sitemap and indexing updates. Manual requests durably queue their validated payload before returning; the worker applies the snapshot.

An invalid record fails the entire snapshot and records an error; it is not silently skipped. Missing-job reconciliation never runs on a failed or incomplete fetch. Two successful complete snapshots at least an hour apart must confirm absence. Another authorized source alias can keep the vacancy open. No source date is reset to make an old posting appear fresh. Greenhouse dates use the explicit original publication field when present; Lever uses `createdAt`; absent dates remain unknown even after moderation.

Deduplication is conservative. Provider IDs identify the same source record. Cross-source aliases require the same employer, application destination and normalized fingerprint. Different requisitions within one source stay separate even when a generic careers URL is shared. Fuzzy auto-merging is deliberately avoided to protect distinct openings.

Disabling a source pauses its active jobs when no enabled alias remains. Restoring the source does not bypass review. Administrators can return paused records to review; source and forensic history remain retained.

## Import shape

JSON is an array of flat records. CSV uses the same header names; quote HTML or commas normally. `skills` and `remoteCountries` use semicolon-separated values in CSV/XML. XML uses `<jobs><job>…fields…</job></jobs>`; HTML can be CDATA.

```json
[
  {
    "externalId": "employer-requisition-123",
    "sourceUrl": "https://employer.example.com/careers/123",
    "title": "Backend Engineer",
    "descriptionHtml": "<p>Supply the actual authorized description, responsibilities and qualifications in full. This illustration is a format example, not a real vacancy.</p>",
    "locationLabel": "Lagos, Nigeria",
    "country": "NG",
    "city": "Lagos",
    "workplace": "onsite",
    "applyUrl": "https://employer.example.com/careers/123/apply"
  }
]
```

Do not load this documentation example as genuine inventory. Optional disclosed compensation needs currency and period. Fully remote entries require explicit applicant country codes. Unknown claims remain absent. Manual imports use external application routes; employer-created jobs can explicitly enable native applications.

## Diagnostics

Review `source_sync_runs`, `ingestion_errors`, mapping missing counters and last-success timestamps. Failed jobs retry with exponential backoff; disabled sources are not fetched. Raw source payloads expire after 30 days without observation. Do not bypass provider restrictions to fix a failed source. Rate/quota or permission problems require the source owner/provider, not anti-bot workarounds.

# Security, privacy and trust

## Implemented controls

- Zod server validation; bounded streamed JSON/webhook/upload bodies.
- Mature authentication, verified email, secure production cookies and password recovery.
- Exact-origin mutation checks, Redis limits and per-operation role/tenant checks.
- Parameterized Drizzle/SQL, query/lock timeouts and explicit constraints.
- Sanitized descriptions/editorial HTML and escaped JSON-LD.
- Fixed-host ATS discovery and explicit approval for custom endpoint hostnames; DNS-pinned public-IP TLS connections, guarded same-host redirects, robots checks, MIME/size/time limits and host pacing.
- HTTPS application URLs without userinfo, IP literals, private-style suffixes or custom ports; approved destination hostnames. Optional link fetching requires separate permission and uses the guarded transport without source credentials.
- Private PDF keys, content/header/size validation, quarantine and short-lived authorized attachment downloads.
- Database uniqueness, transactional settlement, audit records and source permission evidence.
- Signed webhook handling and authoritative provider verification.
- Appropriate response security headers; staging/demo noindex protections.

Source approval/configuration revisions, source leases and one-active-task constraints protect asynchronous collection. Revocation/expiry withdraws source-owned jobs from search and indexing surfaces. Browser execution is disabled by default and uses the optional sandboxed worker; it has not been runtime-validated locally. See JOB_INGESTION for the exact network boundary and remaining staging checks.

## Documents and malware

New PDFs always enter `quarantined`. Quarantined files cannot be applied with or downloaded through the platform. With current ClamAV definitions installed on an operator/scanner host, run:

```bash
npm run documents:scan
```

The command downloads pending private objects, checks their recorded SHA-256, streams bytes to `clamscan`, marks exit 0 clean / exit 1 rejected and writes scanner evidence. Scanner errors leave files quarantined. Install and update ClamAV separately; no fictitious antivirus service is claimed configured. An administrator can also record a manual security review, but must use genuine evidence for the exact hash. Restrict this privilege and audit it.

Configure bucket public-access blocking, encryption, short-lived operator credentials and storage lifecycle policies. Keep S3 credentials off the client. Delete objects before removing their records; failed object deletion prevents a false erasure success.

## Fraud operations

Reports, employer verification, moderation, source disable, account suspension and audit history provide a human review workflow. Unknown salary/sponsorship claims stay unknown. Recruitment-fee warnings and destination transparency are shown to candidates. These mechanisms do not constitute a trained automated scam classifier or a guarantee that every verified listing is safe.

## Production responsibilities

Complete legal entity/contact notices, a jurisdiction-specific retention schedule, processor agreements and privacy request handling. GDPR and Nigerian data protection obligations require actual legal/operational assessment. The application does not assert automatic compliance.

Require HTTPS and a reverse proxy that sanitizes forwarded IP headers. Keep databases, Redis and object storage private. Configure backups, monitoring, dependency updates and least-privilege database accounts. CSP currently permits Next.js inline scripts; nonce-based stricter CSP is an additional hardening item.

Do not log password/reset tokens, session cookies, résumé contents, payment secrets or raw candidate details. Use provider references and audit IDs for investigations. The local development inbox contains authentication links and must never share a database with production.

## Boundaries requiring verification

Live antivirus availability, provider sandbox behavior, multi-process database contention, assistive-technology testing, full penetration testing and production Core Web Vitals require the deployment environment. Passing the repository test suite does not replace these checks.

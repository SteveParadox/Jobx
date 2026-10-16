# Authentication and permissions

Better Auth provides email/password authentication, verification, password reset, session expiry and optional Google OAuth. Passwords use the library's password handling rather than custom hashing. Passwords require at least 12 characters. Email verification is required before privileged account operations. A reset revokes old sessions.

The mounted POST auth handler independently enforces the configured exact origin, in addition to library defenses and Redis request limits. Configure a trusted reverse proxy to overwrite forwarded client-IP headers; do not expose an origin that trusts arbitrary user-supplied proxy headers directly. Mutation APIs require a matching `Origin`. Webhooks are separate and authenticated by provider signatures, not browser cookies.

## Role boundaries

| Principal              | Permissions                                                                                            |
| ---------------------- | ------------------------------------------------------------------------------------------------------ |
| Visitor                | Public search/descriptions, authorized external apply links, report/contact forms                      |
| Verified candidate     | Own profile, documents, saved jobs/searches, alerts, applications, export/erasure                      |
| Employer owner/admin   | Own organization profile/team/billing and recruiter workflows                                          |
| Recruiter              | Own employer's jobs, applications and internal collaboration                                           |
| Viewer                 | Membership/invitation is supported, but private recruiter and billing APIs are denied by default       |
| Platform administrator | Verification, moderation, source/content/support/security operations and explicit audited intervention |

Global administrator is never accepted from a sign-up payload. Employer privileges live in organization memberships, not a client-selected global role. The first administrator must be an existing verified account, promoted by `npm run admin:grant -- email@example.com` from an operator terminal.

Every applicant/file query checks candidate ownership or a relevant employer membership. Application internal notes are excluded from candidate exports/events. Suspended users lose platform API access; administrative suspension also revokes sessions. Demo operator identities cannot resolve an authorized actor in production.

Alert edits, saved-search edits, history deletion and notification read/unread operations check the authenticated account in their database predicate. A foreign or missing resource returns 404. Alert criteria/channel changes and resuming an alert require explicit consent. Preferences are server-validated; candidate preferences cannot grant an employer or administrator role. History opt-in time and preference-change audit events are persisted without copying search keywords into audit logs.

The global email-alert switch cancels queued alert digests and is checked again by the worker before sending. It does not suppress essential verification/reset/application messages or in-app notifications. Profile `emailConsent` is a separate opt-in for optional account communications and does not substitute for job-alert consent. An email whose delivery has already begun cannot be recalled.

## Local email flow

Use `EMAIL_TRANSPORT=development` only in development/test. Read the verification/reset link via `npm run mailbox -- recipient@example.com`; it is never exposed by a public mailbox endpoint. Staging and production require real sender configuration. The development email transport is rejected outside these two environments.

## Invitations and account deletion

Invitations are expiring, hashed capabilities tied to the recipient's verified email. Acceptance is transactional and cannot be replayed to add duplicate memberships. Owners cannot remove the owner through the ordinary team removal action.

The built-in generic delete-user endpoint is disabled so it cannot bypass object cleanup and operator retention rules. The platform erasure flow removes candidate records and credentials, revokes sessions and anonymizes the retained identity. Organization owners must transfer ownership through support first. Accounting/audit obligations require operator legal review, not an assumption that every record can be destroyed.

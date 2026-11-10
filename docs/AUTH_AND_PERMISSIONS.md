# Authentication and permissions

Better Auth provides email/password authentication, verification, password reset, session expiry and optional Google and GitHub OAuth. Passwords use the library's password handling rather than custom hashing. Passwords require at least 12 characters. Email verification is required before privileged account operations. A reset revokes old sessions.

The mounted POST auth handler independently enforces the configured exact origin, in addition to library defenses and Redis request limits. Configure a trusted reverse proxy to overwrite forwarded client-IP headers; do not expose an origin that trusts arbitrary user-supplied proxy headers directly. Mutation APIs require a matching `Origin`. Webhooks are separate and authenticated by provider signatures, not browser cookies.

## Optional Google and GitHub sign-in

Email/password works without OAuth credentials. Google and GitHub buttons appear on the account login/registration page and the signed-out employer entry screen **only after** the corresponding provider's client ID and client secret have both been set. There is no browser-side secret or OAuth access token in client props. The server supplies only availability booleans.

1. Create a Google OAuth 2.0 **Web application** in Google Cloud Console, and configure the consent screen. Add `http://localhost:3000/api/auth/callback/google` as an authorized redirect URI for local development. In production add `https://YOUR_DOMAIN/api/auth/callback/google` to the production OAuth client. Put `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in the environment.
2. Register a GitHub **OAuth App** in GitHub's developer settings. Set its **Authorization callback URL** to `http://localhost:3000/api/auth/callback/github` for local development. For production create a separate OAuth app with callback `https://YOUR_DOMAIN/api/auth/callback/github`, and provide `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` in the environment. GitHub authentication needs a verified email, including `user:email` access for private addresses. Better Auth requests this scope for its built-in GitHub provider; do not add repository or organization permissions to the login-only app.
3. Ensure `SITE_URL` is the exact base origin (`http://localhost:3000` or your HTTPS production URL). Better Auth uses that origin to construct provider callback URLs. Set production variables in the deployment provider's protected environment settings; do not commit secrets or expose them via `NEXT_PUBLIC_*`. Restart the Next.js server after changing local environment variables.

OAuth is initiated with `authClient.signIn.social` (Google or GitHub) and an internal-only success destination: `/dashboard` for candidates or `/employers` for the employer flow. OAuth errors return to `/auth`, retaining the employer context. Email/password and OAuth accounts share the same authorization boundaries. Neither OAuth provider grants organization membership or administrative privileges.

Better Auth may connect a matching verified-email OAuth identity to an existing account under its built-in account-linking policy. Never force-link accounts by email on the client, or treat unverified profile data as a privileged identity. If linking fails, users should sign in with their original method and use an explicit authenticated account-linking flow if available. Existing `requireActor` checks still require email verification for platform actions.

To verify locally: configure test OAuth app credentials, restart `npm run dev`, open `/auth` and `/employers`, confirm both buttons render with the expected styling, sign in with each provider, confirm return paths, and verify email/password fallback. Use the matching deployment callback URLs and dedicated preview/staging OAuth apps as needed.

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

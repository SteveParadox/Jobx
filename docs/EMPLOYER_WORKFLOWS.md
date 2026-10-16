# Employer workflows

## Organization and verification

1. Register and verify an account.
2. Open `/employers` and provide the actual company name, official HTTPS website and description.
3. The owner membership is created in the same transaction as the organization.
4. An administrator checks identity/authorization evidence and records verified or rejected status.
5. Changing the official name or website returns the company to pending verification and invalidates affected indexing state.

Verification means that evidence was reviewed. It does not certify every claim, guarantee applications or promise an offer to candidates.

## Posting lifecycle

Create a draft, use preview, save and submit for review. Only an administrator can publish a pending job. The employer must be enabled and verified, the description substantive, the application destination valid and the deadline unexpired. A free organization can have one active employer-submitted vacancy; current paid access changes that allowance. Authorized source-mapped listings are moderated but do not consume this direct-posting allowance.

An edit of an active listing removes it from public active results and returns it to pending review. Version numbers prevent stale editor tabs from overwriting newer changes. Pause, close and expired states remove active schema/sitemap membership. A copied template creates a new UUID and never reuses an existing job URL. Extension/reopening requires editing the deadline and resubmitting; the original posting date is retained.

## Applications

The employer explicitly chooses native or external applications. A native job can require a clean résumé. Candidates submit only to active jobs, duplicate candidate/job submissions are rejected and success is returned after the transaction commits. Candidates receive a persisted in-app confirmation and an email delivery record.

Recruiters can review relevant native applications, move them through stages and add internal notes/history. Candidates see their current application status, not private notes. Once withdrawn, an employer cannot advance the application. External clicks never appear as confirmed native submissions. External self-reported submissions are explicitly labeled as such.

Authorized applicant CSV export escapes spreadsheet formula prefixes and includes only data returned by the tenant-authorized endpoint. Downloading a résumé requires ownership or access through a relevant native application and produces a one-minute attachment URL.

## Teams and paid placements

Owners/admins invite verified recipient emails with expiring invitation tokens. Membership controls remain server-side. Current paid placement permission is checked before featuring a job, and placement expiry cannot extend past the paid period or job deadline. Sponsored labels are displayed without secretly moving results above more relevant jobs.

## Limits

Native tracking is an internal workflow. There is no claimed synchronization with external ATS hiring outcomes. Cross-organization ownership transfer and advanced custom stages can be added through an audited operator workflow; automatic ownership transfer is not exposed.

import { getDb } from '@/db';
import * as s from '@/db/schema';
import { brand } from '@/lib/config';
import { sendEmail } from '@/lib/email';
import { escapeHtml } from '@/lib/security';
import { alertToken } from '@/lib/unsubscribe';
import { and, desc, eq, sql } from 'drizzle-orm';
import { searchConditions } from './search';
import { jobPath } from './seo';
import { searchSchema } from './validation';
export async function generateDigests() {
  const db = getDb();
  const alerts = await db
    .select({ alert: s.alerts, email: s.user.email })
    .from(s.alerts)
    .innerJoin(s.user, eq(s.alerts.userId, s.user.id))
    .where(
      and(
        eq(s.alerts.enabled, true),
        eq(s.user.emailVerified, true),
        eq(s.user.disabled, false),
        sql`(${s.alerts.lastRunAt} is null or ${s.alerts.lastRunAt}<now()-case when ${s.alerts.frequency}='weekly' then interval '7 days' else interval '1 day' end)`,
      ),
    )
    .orderBy(sql`${s.alerts.lastRunAt} asc nulls first`, s.alerts.id)
    .limit(1000);
  let count = 0;
  for (const { alert, email } of alerts) {
    const now = new Date();
    await db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(s.alerts)
        .where(eq(s.alerts.id, alert.id))
        .for('update');
      const period = (current?.frequency === 'weekly' ? 7 : 1) * 86400000;
      if (
        !current?.enabled ||
        (current.lastRunAt && now.getTime() - current.lastRunAt.getTime() < period)
      )
        return;
      const [preferences] = await tx
        .select()
        .from(s.candidatePreferences)
        .where(eq(s.candidatePreferences.userId, current.userId));
      const filters = searchSchema.parse(current.filters);
      const matches = await tx
        .select({ job: s.jobs })
        .from(s.jobs)
        .innerJoin(s.employers, eq(s.jobs.employerId, s.employers.id))
        .where(
          and(
            searchConditions(filters),
            sql`${s.jobs.publishedAt}>=${current.consentedAt}`,
            sql`not exists(select 1 from notifications where dedupe_key='match:'||${current.id}||':'||${s.jobs.id}::text)`,
          ),
        )
        .orderBy(desc(s.jobs.publishedAt))
        .limit(100);
      for (const { job } of matches)
        await tx
          .insert(s.notifications)
          .values({
            userId: current.userId,
            title: job.title,
            body: `A new opening matches ${current.name}`,
            href: jobPath(job),
            dedupeKey: `match:${current.id}:${job.id}`,
          })
          .onConflictDoNothing();
      if (
        matches.length &&
        current.channel === 'email' &&
        preferences?.emailAlertsEnabled !== false
      ) {
        const unsubscribe = `${brand.url}/unsubscribe?token=${encodeURIComponent(alertToken(current.id))}`;
        const html = `<h1>${escapeHtml(current.name)}</h1><ul>${matches.map(({ job }) => `<li><a href="${brand.url + jobPath(job)}">${escapeHtml(job.title)}</a> — ${escapeHtml(job.locationLabel)}</li>`).join('')}</ul><p><a href="${unsubscribe}">Unsubscribe</a></p>`;
        await tx
          .insert(s.deliveries)
          .values({
            alertId: current.id,
            userId: current.userId,
            to: email,
            subject: `${matches.length} new opportunities · ${current.name}`,
            body: html,
            dedupeKey: `digest:${current.id}:${now.toISOString().slice(0, 10)}:${current.consentedAt.getTime()}`,
          })
          .onConflictDoNothing();
        count++;
      }
      await tx.update(s.alerts).set({ lastRunAt: now }).where(eq(s.alerts.id, alert.id));
    });
  }
  return count;
}
export async function deliverNotification(id: string) {
  const db = getDb();
  // Commit this marker before network I/O: a crash after provider acceptance must not
  // erase the start of the provider's idempotency window, even if the send transaction rolls back.
  await db
    .update(s.deliveries)
    .set({
      firstAttemptAt: sql`coalesce(${s.deliveries.firstAttemptAt},case when ${s.deliveries.attempts}>0 then ${s.deliveries.createdAt} else now() end)`,
    })
    .where(and(eq(s.deliveries.id, id), sql`${s.deliveries.status} in ('pending','sending')`));
  const failure = await db.transaction(async (tx) => {
    // A row lock serializes duplicate worker claims. Network I/O is bounded to 15s.
    const [d] = await tx.select().from(s.deliveries).where(eq(s.deliveries.id, id)).for('update');
    if (!d || !['pending', 'sending'].includes(d.status)) return;
    const [owner] = await tx.select().from(s.user).where(eq(s.user.id, d.userId));
    const [preferences] = await tx
      .select()
      .from(s.candidatePreferences)
      .where(eq(s.candidatePreferences.userId, d.userId));
    const [alert] = d.alertId
      ? await tx.select().from(s.alerts).where(eq(s.alerts.id, d.alertId))
      : [];
    // Invitations are sent to a prospective member, not to the inviter's email.
    // Verify the invitation's current recipient, expiry, employer and inviter authority.
    const invitationId = d.dedupeKey.startsWith('invitation:')
      ? d.dedupeKey.slice('invitation:'.length)
      : null;
    const [invitation] = invitationId
      ? await tx.select().from(s.invitations).where(eq(s.invitations.id, invitationId))
      : [];
    const [inviterMembership] = invitation
      ? await tx
          .select({ role: s.memberships.role, disabled: s.employers.disabled })
          .from(s.memberships)
          .innerJoin(s.employers, eq(s.memberships.employerId, s.employers.id))
          .where(and(eq(s.memberships.employerId, invitation.employerId), eq(s.memberships.userId, d.userId)))
      : [];
    const validRecipient = invitationId
      ? Boolean(
          invitation &&
            invitation.email === d.to.trim().toLowerCase() &&
            !invitation.acceptedAt &&
            invitation.expiresAt > new Date() &&
            inviterMembership &&
            !inviterMembership.disabled &&
            ['owner', 'admin'].includes(inviterMembership.role),
        )
      : owner?.email === d.to;
    if (
      !owner ||
      owner.disabled ||
      !owner.emailVerified ||
      !validRecipient ||
      (d.alertId &&
        (!alert?.enabled ||
          alert.channel !== 'email' ||
          preferences?.emailAlertsEnabled === false ||
          alert.consentedAt > d.createdAt))
    ) {
      await tx.update(s.deliveries).set({ status: 'cancelled' }).where(eq(s.deliveries.id, id));
      return;
    }
    // Resend retains keys for 24h. Leave a margin; review rather than risk a duplicate.
    if (
      !d.firstAttemptAt ||
      Date.now() - d.firstAttemptAt.getTime() > 23 * 3600000 ||
      d.attempts >= 5
    ) {
      await tx
        .update(s.deliveries)
        .set({
          status: 'review',
          lastError:
            d.attempts >= 5
              ? 'Delivery retry limit reached'
              : 'Delivery is outside provider idempotency window',
        })
        .where(eq(s.deliveries.id, id));
      return;
    }
    await tx
      .update(s.deliveries)
      .set({ status: 'sending', attempts: d.attempts + 1 })
      .where(eq(s.deliveries.id, id));
    try {
      const providerId = await sendEmail(d.to, d.subject, d.body, d.dedupeKey);
      await tx
        .update(s.deliveries)
        .set({ status: 'sent', sentAt: new Date(), providerId, to: owner.email, lastError: null })
        .where(eq(s.deliveries.id, id));
    } catch (error) {
      await tx
        .update(s.deliveries)
        .set({
          status: d.attempts + 1 >= 5 ? 'review' : 'pending',
          lastError: error instanceof Error ? error.message.slice(0, 500) : 'Email delivery failed',
        })
        .where(eq(s.deliveries.id, id));
      return error instanceof Error ? error : new Error('Email delivery failed');
    }
  });
  if (failure) throw failure;
}

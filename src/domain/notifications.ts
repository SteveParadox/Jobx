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
    .select({ alert: s.alerts, email: s.user.email, disabled: s.user.disabled })
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
    .limit(1000);
  let count = 0;
  for (const { alert, email } of alerts) {
    const now = new Date();
    const period = (alert.frequency === 'weekly' ? 7 : 1) * 86400000;
    if (alert.lastRunAt && now.getTime() - alert.lastRunAt.getTime() < period) continue;
    await db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(s.alerts)
        .where(eq(s.alerts.id, alert.id))
        .for('update');
      if (
        !current.enabled ||
        (current.lastRunAt && now.getTime() - current.lastRunAt.getTime() < period)
      )
        return;
      const filters = searchSchema.parse(alert.filters);
      const matches = await tx
        .select({ job: s.jobs })
        .from(s.jobs)
        .innerJoin(s.employers, eq(s.jobs.employerId, s.employers.id))
        .where(
          and(
            searchConditions(filters),
            sql`${s.jobs.publishedAt}>=${alert.createdAt}`,
            sql`not exists(select 1 from notifications where dedupe_key='match:'||${alert.id}||':'||${s.jobs.id}::text)`,
          ),
        )
        .orderBy(desc(s.jobs.publishedAt))
        .limit(100);
      for (const { job } of matches)
        await tx
          .insert(s.notifications)
          .values({
            userId: alert.userId,
            title: job.title,
            body: `A new opening matches ${alert.name}`,
            href: jobPath(job),
            dedupeKey: `match:${alert.id}:${job.id}`,
          })
          .onConflictDoNothing();
      if (matches.length && alert.channel === 'email') {
        const unsubscribe = `${brand.url}/unsubscribe?token=${encodeURIComponent(alertToken(alert.id))}`;
        const html = `<h1>${escapeHtml(alert.name)}</h1><ul>${matches.map(({ job }) => `<li><a href="${brand.url + jobPath(job)}">${escapeHtml(job.title)}</a> — ${escapeHtml(job.locationLabel)}</li>`).join('')}</ul><p><a href="${unsubscribe}">Unsubscribe</a></p>`;
        await tx
          .insert(s.deliveries)
          .values({
            alertId: alert.id,
            userId: alert.userId,
            to: email,
            subject: `${matches.length} new opportunities · ${alert.name}`,
            body: html,
            dedupeKey: `digest:${alert.id}:${now.toISOString().slice(0, 10)}`,
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
  const [d] = await db.select().from(s.deliveries).where(eq(s.deliveries.id, id));
  if (!d || d.status === 'sent' || d.status === 'cancelled') return;
  if (d.alertId) {
    const [alert] = await db.select().from(s.alerts).where(eq(s.alerts.id, d.alertId));
    if (!alert?.enabled) {
      await db.update(s.deliveries).set({ status: 'cancelled' }).where(eq(s.deliveries.id, id));
      return;
    }
  }
  const [owner] = await db.select().from(s.user).where(eq(s.user.id, d.userId));
  if (!owner || owner.disabled || !owner.emailVerified) return;
  // Resend retains idempotency keys for 24h; ambiguous deliveries beyond that window need review.
  if (d.attempts > 0 && Date.now() - d.createdAt.getTime() > 23 * 3600000) {
    await db
      .update(s.deliveries)
      .set({ status: 'review', lastError: 'Delivery is outside provider idempotency window' })
      .where(eq(s.deliveries.id, id));
    return;
  }
  await db
    .update(s.deliveries)
    .set({ status: 'sending', attempts: sql`${s.deliveries.attempts}+1` })
    .where(eq(s.deliveries.id, id));
  try {
    const providerId = await sendEmail(d.to, d.subject, d.body, d.dedupeKey);
    await db
      .update(s.deliveries)
      .set({ status: 'sent', sentAt: new Date(), providerId, lastError: null })
      .where(eq(s.deliveries.id, id));
  } catch (error) {
    await db
      .update(s.deliveries)
      .set({
        status: 'pending',
        lastError: error instanceof Error ? error.message.slice(0, 500) : 'Email delivery failed',
      })
      .where(eq(s.deliveries.id, id));
    throw error;
  }
}

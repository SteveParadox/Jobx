import { getDb } from '@/db';
import * as s from '@/db/schema';
import { type Actor, admin, employerAccess } from '@/lib/auth';
import { AppError, requireValue } from '@/lib/errors';
import { and, desc, eq, gt, lte, sql } from 'drizzle-orm';
import { audit } from './jobs';
export async function platformMetrics(actor: Actor) {
  admin(actor);
  const db = getDb();
  const [events, applications, revenue, categories, locations, sourceFailures] = await Promise.all([
    db
      .select({ event: s.analytics.event, count: sql<number>`count(*)::int` })
      .from(s.analytics)
      .groupBy(s.analytics.event),
    db
      .select({
        kind: s.applications.kind,
        status: s.applications.status,
        count: sql<number>`count(*)::int`,
      })
      .from(s.applications)
      .groupBy(s.applications.kind, s.applications.status),
    db
      .select({
        currency: s.transactions.currency,
        total: sql<number>`coalesce(sum(${s.transactions.amount}),0)::bigint`,
      })
      .from(s.transactions)
      .where(eq(s.transactions.status, 'paid'))
      .groupBy(s.transactions.currency),
    db
      .select({ category: s.jobs.category, count: sql<number>`count(*)::int` })
      .from(s.jobs)
      .where(eq(s.jobs.status, 'active'))
      .groupBy(s.jobs.category),
    db
      .select({ country: s.jobs.country, count: sql<number>`count(*)::int` })
      .from(s.jobs)
      .where(eq(s.jobs.status, 'active'))
      .groupBy(s.jobs.country),
    db
      .select({ sourceId: s.syncRuns.sourceId, count: sql<number>`count(*)::int` })
      .from(s.syncRuns)
      .where(eq(s.syncRuns.status, 'failed'))
      .groupBy(s.syncRuns.sourceId),
  ]);
  return {
    events,
    applications,
    revenue,
    categories,
    locations,
    sourceFailures,
    notes:
      'External clicks and self-reported submissions are separate from confirmed native applications. Revenue values are in each currency’s minor units.',
  };
}
export async function employerMetrics(actor: Actor, employerId: string) {
  await employerAccess(actor, employerId);
  return getDb()
    .select({
      id: s.jobs.id,
      title: s.jobs.title,
      applications: sql<number>`(select count(*)::int from applications where job_id=${s.jobs.id} and kind='native')`,
      externalClicks: sql<number>`(select count(*)::int from applications where job_id=${s.jobs.id} and status='clicked_external')`,
      views: sql<number>`(select count(*)::int from analytics_events where job_id=${s.jobs.id} and event='job_detail_viewed')`,
    })
    .from(s.jobs)
    .where(eq(s.jobs.employerId, employerId))
    .limit(200);
}
export async function featureJob(actor: Actor, employerId: string, jobId: string, days: number) {
  await employerAccess(actor, employerId, ['owner', 'admin']);
  return getDb().transaction(async (tx) => {
    await tx.select().from(s.employers).where(eq(s.employers.id, employerId)).for('update');
    const job = requireValue(
      (
        await tx
          .select()
          .from(s.jobs)
          .where(
            and(
              eq(s.jobs.id, jobId),
              eq(s.jobs.employerId, employerId),
              eq(s.jobs.status, 'active'),
            ),
          )
      )[0],
    );
    const [sub] = await tx
      .select()
      .from(s.subscriptions)
      .where(
        and(
          eq(s.subscriptions.employerId, employerId),
          eq(s.subscriptions.status, 'active'),
          eq(s.subscriptions.featured, true),
          lte(s.subscriptions.startsAt, new Date()),
          gt(s.subscriptions.endsAt, new Date()),
        ),
      )
      .orderBy(desc(s.subscriptions.endsAt))
      .limit(1);
    if (!sub)
      throw new AppError(402, 'A current paid plan with featured placement access is required');
    const endsAt = new Date(
      Math.min(
        sub.endsAt.getTime(),
        Date.now() + days * 86400000,
        job.expiresAt?.getTime() ?? Infinity,
      ),
    );
    if (endsAt <= new Date()) throw new AppError(409, 'The job has expired');
    await tx.delete(s.placements).where(eq(s.placements.jobId, jobId));
    await tx.insert(s.placements).values({ jobId, employerId, startsAt: new Date(), endsAt });
    await audit(tx, actor.id, 'job.featured', jobId, { endsAt: endsAt.toISOString() });
    return { endsAt };
  });
}

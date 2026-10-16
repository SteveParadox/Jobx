import { getDb } from '@/db';
import * as s from '@/db/schema';
import { type Actor, admin } from '@/lib/auth';
import { env } from '@/lib/config';
import { and, desc, eq, inArray, lte, sql } from 'drizzle-orm';
import { sourceHealth } from './ingestion';
import { audit, invalidateEmployerJobs } from './jobs';
import { availability, publicJobFields } from './search';
import { eligible } from './seo';
export async function adminOverview(actor: Actor) {
  admin(actor);
  const db = getDb();
  const [
    jobCounts,
    companies,
    reports,
    sources,
    failedDeliveries,
    payments,
    audits,
    users,
    content,
    quarantine,
    support,
    subscriptions,
  ] = await Promise.all([
    db
      .select({ status: s.jobs.status, count: sql<number>`count(*)::int` })
      .from(s.jobs)
      .groupBy(s.jobs.status),
    db.select().from(s.employers).orderBy(desc(s.employers.createdAt)).limit(100),
    db.select().from(s.jobReports).where(eq(s.jobReports.status, 'open')).limit(100),
    sourceHealth(),
    db
      .select({
        id: s.deliveries.id,
        status: s.deliveries.status,
        lastError: s.deliveries.lastError,
      })
      .from(s.deliveries)
      .where(inArray(s.deliveries.status, ['review', 'pending']))
      .limit(100),
    db.select().from(s.checkouts).orderBy(desc(s.checkouts.createdAt)).limit(100),
    db.select().from(s.auditLogs).orderBy(desc(s.auditLogs.createdAt)).limit(100),
    db
      .select({
        id: s.user.id,
        name: s.user.name,
        email: s.user.email,
        disabled: s.user.disabled,
        role: s.user.role,
      })
      .from(s.user)
      .limit(100),
    db.select().from(s.editorial).limit(100),
    db
      .select({ id: s.resumes.id, filename: s.resumes.filename, sha256: s.resumes.sha256 })
      .from(s.resumes)
      .where(eq(s.resumes.status, 'quarantined'))
      .limit(100),
    db.select().from(s.supportRequests).where(eq(s.supportRequests.status, 'open')).limit(100),
    db.select().from(s.subscriptions).limit(100),
  ]);
  const pendingJobs = await db
    .select({ job: s.jobs, company: s.employers.name })
    .from(s.jobs)
    .innerJoin(s.employers, eq(s.jobs.employerId, s.employers.id))
    .where(inArray(s.jobs.status, ['pending', 'paused']))
    .limit(100);
  return {
    jobCounts,
    companies,
    reports,
    sources,
    pendingJobs,
    failedDeliveries,
    payments,
    audits,
    users,
    content,
    quarantine,
    support,
    subscriptions,
  };
}
export async function seoHealth(actor: Actor) {
  admin(actor);
  const db = getDb();
  const active = await db
    .select(publicJobFields)
    .from(s.jobs)
    .innerJoin(s.employers, eq(s.jobs.employerId, s.employers.id))
    .where(availability())
    .limit(5000);
  const valid = active.filter(eligible);
  const [{ expired }] = await db
    .select({ expired: sql<number>`count(*)::int` })
    .from(s.jobs)
    .where(and(eq(s.jobs.status, 'active'), lte(s.jobs.expiresAt, new Date())));
  return {
    sampleSize: active.length,
    sampleLimit: 5000,
    indexableActiveJobs: valid.length,
    schemaInvalid: active
      .filter((v) => !eligible(v))
      .map((v) => ({
        id: v.id,
        title: v.title,
        reason: !v.originalPostedAt
          ? 'Original posting date unknown'
          : 'Not eligible under environment or validated location policy',
      })),
    expiredAwaitingWorker: expired,
    canonicalPolicy: 'UUID and current slug; previous slugs redirect permanently',
    sitemap: '/sitemap.xml',
    stagingNoindex: env.APP_ENV !== 'production',
    indexingEnabled: env.GOOGLE_INDEXING_ENABLED,
    searchConsole: 'Not connected',
    organicPerformance: 'Analytics integration not connected',
    linkAudit:
      'External destinations are validated at ingestion; live reachability monitoring is not configured',
  };
}
export async function disableEmployer(actor: Actor, id: string, disabled: boolean) {
  admin(actor);
  await getDb().transaction(async (tx) => {
    await tx
      .update(s.employers)
      .set({ disabled, updatedAt: new Date() })
      .where(eq(s.employers.id, id));
    await invalidateEmployerJobs(tx, id, disabled ? 'URL_DELETED' : 'URL_UPDATED');
    await audit(tx, actor.id, 'employer.disabled', id, { disabled });
  });
}

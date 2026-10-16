import { getDb } from '@/db';
import * as s from '@/db/schema';
import type { Actor } from '@/lib/auth';
import { brand } from '@/lib/config';
import { AppError, requireValue } from '@/lib/errors';
import { digest } from '@/lib/security';
import { alertToken } from '@/lib/unsubscribe';
import { and, desc, eq, or } from 'drizzle-orm';
import { getPublicJob, searchJobs } from './search';
import { active } from './seo';
import { alertSchema, searchSchema } from './validation';
export async function toggleSaved(actor: Actor, jobId: string, save: boolean) {
  requireValue(await getPublicJob(jobId));
  if (save)
    await getDb().insert(s.savedJobs).values({ userId: actor.id, jobId }).onConflictDoNothing();
  else
    await getDb()
      .delete(s.savedJobs)
      .where(and(eq(s.savedJobs.userId, actor.id), eq(s.savedJobs.jobId, jobId)));
  return { saved: save };
}
export async function createAlert(actor: Actor, input: unknown) {
  const data = alertSchema.parse(input);
  const id = crypto.randomUUID();
  const secret = alertToken(id);
  const [alert] = await getDb()
    .insert(s.alerts)
    .values({
      id,
      userId: actor.id,
      name: data.name,
      filters: data.filters,
      frequency: data.frequency,
      channel: data.channel,
      unsubscribeHash: digest(secret),
    })
    .returning();
  return { id: alert.id, unsubscribeToken: secret };
}
export async function candidateDashboard(actor: Actor) {
  const db = getDb();
  const [profile, saved, applications, alerts, resumes, notifications, searches] =
    await Promise.all([
      db.select().from(s.profiles).where(eq(s.profiles.userId, actor.id)),
      db
        .select({ job: s.jobs, company: s.employers.name })
        .from(s.savedJobs)
        .innerJoin(s.jobs, eq(s.savedJobs.jobId, s.jobs.id))
        .innerJoin(s.employers, eq(s.jobs.employerId, s.employers.id))
        .where(eq(s.savedJobs.userId, actor.id))
        .limit(200),
      db
        .select({ application: s.applications, title: s.jobs.title })
        .from(s.applications)
        .innerJoin(s.jobs, eq(s.applications.jobId, s.jobs.id))
        .where(eq(s.applications.userId, actor.id))
        .orderBy(desc(s.applications.createdAt))
        .limit(200),
      db
        .select({
          id: s.alerts.id,
          name: s.alerts.name,
          frequency: s.alerts.frequency,
          enabled: s.alerts.enabled,
          channel: s.alerts.channel,
        })
        .from(s.alerts)
        .where(eq(s.alerts.userId, actor.id)),
      db
        .select({
          id: s.resumes.id,
          filename: s.resumes.filename,
          status: s.resumes.status,
          createdAt: s.resumes.createdAt,
        })
        .from(s.resumes)
        .where(eq(s.resumes.userId, actor.id)),
      db
        .select()
        .from(s.notifications)
        .where(eq(s.notifications.userId, actor.id))
        .orderBy(desc(s.notifications.createdAt))
        .limit(50),
      db.select().from(s.savedSearches).where(eq(s.savedSearches.userId, actor.id)).limit(50),
    ]);
  return {
    profile: profile[0] ?? null,
    saved,
    applications,
    alerts,
    resumes,
    notifications,
    searches,
  };
}
export async function trackExternal(
  actor: Actor,
  jobId: string,
  status: 'clicked_external' | 'applied_external' = 'clicked_external',
) {
  const job = requireValue(await getPublicJob(jobId));
  if (job.applicationMethod !== 'external') throw new AppError(400, 'This is a native application');
  if (!active(job) && status === 'clicked_external') throw new AppError(409, 'This job is closed');
  const [app] = await getDb()
    .insert(s.applications)
    .values({ jobId, userId: actor.id, kind: 'external', status })
    .onConflictDoUpdate({
      target: [s.applications.userId, s.applications.jobId],
      set:
        status === 'applied_external'
          ? { status, updatedAt: new Date() }
          : { updatedAt: new Date() },
    })
    .returning();
  return app;
}
export async function saveSearch(actor: Actor, name: string, filters: unknown) {
  const parsed = searchSchema.parse(filters);
  return (
    await getDb()
      .insert(s.savedSearches)
      .values({ userId: actor.id, name, filters: parsed })
      .returning()
  )[0];
}
export async function recommendations(actor: Actor) {
  const [p] = await getDb().select().from(s.profiles).where(eq(s.profiles.userId, actor.id));
  if (!p?.skills.length)
    return { jobs: [], explanation: 'Add your skills to see relevant openings.' };
  return {
    ...(await searchJobs({ q: p.skills.slice(0, 5).join(' OR ') })),
    explanation: 'Matches use only the skills you added; review the actual qualifications.',
  };
}
export async function exportCandidateData(actor: Actor) {
  const data = await candidateDashboard(actor);
  const [events, deliveries] = await Promise.all([
    getDb()
      .select({
        id: s.applicationEvents.id,
        status: s.applicationEvents.status,
        createdAt: s.applicationEvents.createdAt,
      })
      .from(s.applicationEvents)
      .innerJoin(s.applications, eq(s.applicationEvents.applicationId, s.applications.id))
      .where(and(eq(s.applications.userId, actor.id), eq(s.applicationEvents.internal, false))),
    getDb()
      .select({
        id: s.deliveries.id,
        status: s.deliveries.status,
        createdAt: s.deliveries.createdAt,
      })
      .from(s.deliveries)
      .where(eq(s.deliveries.userId, actor.id)),
  ]);
  return {
    exportedAt: new Date().toISOString(),
    account: { id: actor.id, name: actor.name, email: actor.email },
    ...data,
    events,
    deliveries,
  };
}
export async function unsubscribe(secret: string) {
  const id = secret.split('.')[0];
  const signed = /^[0-9a-f-]{36}$/.test(id) && digest(secret) === digest(alertToken(id));
  const [alert] = await getDb()
    .update(s.alerts)
    .set({ enabled: false })
    .where(
      or(eq(s.alerts.unsubscribeHash, digest(secret)), ...(signed ? [eq(s.alerts.id, id)] : [])),
    )
    .returning();
  return Boolean(alert);
}
export const unsubscribeUrl = (secret: string) =>
  `${brand.url}/unsubscribe?token=${encodeURIComponent(secret)}`;

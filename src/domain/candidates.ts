import { getDb } from '@/db';
import * as s from '@/db/schema';
import type { Actor } from '@/lib/auth';
import { brand } from '@/lib/config';
import { AppError, requireValue } from '@/lib/errors';
import { digest } from '@/lib/security';
import { alertToken } from '@/lib/unsubscribe';
import { and, desc, eq, inArray, lt, or, sql } from 'drizzle-orm';
import { audit } from './jobs';
import { getPublicJob, searchJobs } from './search';
import { historyFilters } from './search-state';
import { active } from './seo';
import {
  alertSchema,
  alertUpdateSchema,
  candidatePreferencesSchema,
  savedSearchSchema,
  searchSchema,
  type SearchFilters,
} from './validation';
export const defaultCandidatePreferences = {
  emailAlertsEnabled: true,
  searchHistoryEnabled: false,
  historyConsentedAt: null as Date | null,
};
const historyCutoff = () => new Date(Date.now() - 90 * 86400000);
const searchFingerprint = (filters: SearchFilters) =>
  digest(
    JSON.stringify(
      Object.fromEntries(
        Object.entries(historyFilters(filters)).map(([key, value]) => [
          key,
          typeof value === 'string' ? value.toLowerCase() : value,
        ]),
      ),
    ),
  );

export async function updateCandidatePreferences(actor: Actor, input: unknown) {
  const data = candidatePreferencesSchema.parse(input);
  return getDb().transaction(async (tx) => {
    // Serialize recording/erasure and simultaneous preference upserts for this account.
    requireValue((await tx.select().from(s.user).where(eq(s.user.id, actor.id)).for('update'))[0]);
    const [old] = await tx
      .select()
      .from(s.candidatePreferences)
      .where(eq(s.candidatePreferences.userId, actor.id));
    const values = {
      ...data,
      historyConsentedAt: data.searchHistoryEnabled
        ? (old?.historyConsentedAt ?? new Date())
        : null,
      updatedAt: new Date(),
    };
    const [preferences] = await tx
      .insert(s.candidatePreferences)
      .values({ ...values, userId: actor.id })
      .onConflictDoUpdate({ target: s.candidatePreferences.userId, set: values })
      .returning();
    if (!data.searchHistoryEnabled)
      await tx.delete(s.searchHistory).where(eq(s.searchHistory.userId, actor.id));
    if (!data.emailAlertsEnabled)
      await tx
        .update(s.deliveries)
        .set({ status: 'cancelled' })
        .where(
          and(
            eq(s.deliveries.userId, actor.id),
            sql`${s.deliveries.alertId} is not null`,
            inArray(s.deliveries.status, ['pending', 'sending']),
          ),
        );
    await audit(tx, actor.id, 'candidate.preferences.updated', actor.id, data);
    return preferences;
  });
}

export async function recordSearch(actor: Actor, input: unknown) {
  const parsed = searchSchema.parse(input);
  const filters = historyFilters(parsed);
  if (!Object.keys(filters).length) return { recorded: false };
  const fingerprint = searchFingerprint(parsed);
  return getDb().transaction(async (tx) => {
    const [owner] = await tx.select().from(s.user).where(eq(s.user.id, actor.id)).for('update');
    if (!owner || owner.disabled) return { recorded: false };
    const [preferences] = await tx
      .select()
      .from(s.candidatePreferences)
      .where(eq(s.candidatePreferences.userId, actor.id));
    if (!preferences?.searchHistoryEnabled) return { recorded: false };
    await tx
      .insert(s.searchHistory)
      .values({ userId: actor.id, fingerprint, filters })
      .onConflictDoUpdate({
        target: [s.searchHistory.userId, s.searchHistory.fingerprint],
        set: { filters, lastUsedAt: new Date() },
      });
    await tx
      .delete(s.searchHistory)
      .where(
        and(eq(s.searchHistory.userId, actor.id), lt(s.searchHistory.lastUsedAt, historyCutoff())),
      );
    const excess = await tx
      .select({ id: s.searchHistory.id })
      .from(s.searchHistory)
      .where(eq(s.searchHistory.userId, actor.id))
      .orderBy(desc(s.searchHistory.lastUsedAt), desc(s.searchHistory.id))
      .offset(50);
    if (excess.length)
      await tx.delete(s.searchHistory).where(
        inArray(
          s.searchHistory.id,
          excess.map((row) => row.id),
        ),
      );
    return { recorded: true };
  });
}

export async function clearSearchHistory(actor: Actor, id?: string) {
  await getDb().transaction(async (tx) => {
    await tx.select().from(s.user).where(eq(s.user.id, actor.id)).for('update');
    const removed = await tx
      .delete(s.searchHistory)
      .where(and(eq(s.searchHistory.userId, actor.id), ...(id ? [eq(s.searchHistory.id, id)] : [])))
      .returning({ id: s.searchHistory.id });
    if (id) requireValue(removed[0]);
  });
  return { deleted: true };
}

export async function pruneSearchHistory() {
  await getDb().delete(s.searchHistory).where(lt(s.searchHistory.lastUsedAt, historyCutoff()));
}

export async function updateAlert(actor: Actor, id: string, input: unknown) {
  const data = alertUpdateSchema.parse(input);
  return getDb().transaction(async (tx) => {
    const current = requireValue(
      (
        await tx
          .select()
          .from(s.alerts)
          .where(and(eq(s.alerts.id, id), eq(s.alerts.userId, actor.id)))
          .for('update')
      )[0],
    );
    const changed =
      (data.filters !== undefined &&
        searchFingerprint(data.filters) !==
          searchFingerprint(searchSchema.parse(current.filters))) ||
      (data.channel !== undefined && data.channel !== current.channel) ||
      (data.enabled === true && !current.enabled);
    if (changed && !data.consent)
      throw new AppError(400, 'Confirm consent for these alert settings');
    const { consent: _consent, ...values } = data;
    void _consent;
    const [alert] = await tx
      .update(s.alerts)
      .set({
        ...values,
        ...(data.filters ? { filters: { ...data.filters, page: 1 } } : {}),
        ...(changed ? { consentedAt: new Date(), lastRunAt: null } : {}),
      })
      .where(eq(s.alerts.id, id))
      .returning();
    // Old digests must not be sent under newly edited criteria or after a pause.
    if (changed || data.enabled === false)
      await tx
        .update(s.deliveries)
        .set({ status: 'cancelled' })
        .where(
          and(eq(s.deliveries.alertId, id), inArray(s.deliveries.status, ['pending', 'sending'])),
        );
    return { id: alert.id, enabled: alert.enabled };
  });
}

export async function markNotification(actor: Actor, id: string, read: boolean) {
  const [notification] = await getDb()
    .update(s.notifications)
    .set({ readAt: read ? new Date() : null })
    .where(and(eq(s.notifications.id, id), eq(s.notifications.userId, actor.id)))
    .returning({ id: s.notifications.id, readAt: s.notifications.readAt });
  return requireValue(notification);
}

export async function markAllNotificationsRead(actor: Actor) {
  await getDb()
    .update(s.notifications)
    .set({ readAt: new Date() })
    .where(and(eq(s.notifications.userId, actor.id), sql`${s.notifications.readAt} is null`));
  return { saved: true };
}
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
      filters: { ...data.filters, page: 1 },
      frequency: data.frequency,
      channel: data.channel,
      unsubscribeHash: digest(secret),
    })
    .returning();
  return { id: alert.id, unsubscribeToken: secret };
}
export async function candidateDashboard(actor: Actor) {
  const db = getDb();
  const [
    profile,
    saved,
    applications,
    alerts,
    resumes,
    notifications,
    searches,
    preferences,
    history,
  ] = await Promise.all([
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
        filters: s.alerts.filters,
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
    db.select().from(s.candidatePreferences).where(eq(s.candidatePreferences.userId, actor.id)),
    db
      .select({
        id: s.searchHistory.id,
        filters: s.searchHistory.filters,
        lastUsedAt: s.searchHistory.lastUsedAt,
      })
      .from(s.searchHistory)
      .where(
        and(
          eq(s.searchHistory.userId, actor.id),
          sql`${s.searchHistory.lastUsedAt}>=${historyCutoff()}`,
        ),
      )
      .orderBy(desc(s.searchHistory.lastUsedAt), desc(s.searchHistory.id))
      .limit(50),
  ]);
  return {
    profile: profile[0] ?? null,
    saved,
    applications,
    alerts,
    resumes,
    notifications,
    searches,
    preferences: preferences[0] ?? defaultCandidatePreferences,
    history,
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
export async function saveSearch(actor: Actor, name: string, filters: unknown, id?: string) {
  const data = savedSearchSchema.parse({ name, filters });
  const values = { name: data.name, filters: { ...data.filters, page: 1 } };
  if (id) {
    const [search] = await getDb()
      .update(s.savedSearches)
      .set(values)
      .where(and(eq(s.savedSearches.id, id), eq(s.savedSearches.userId, actor.id)))
      .returning();
    return requireValue(search);
  }
  return (
    await getDb()
      .insert(s.savedSearches)
      .values({ userId: actor.id, ...values })
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

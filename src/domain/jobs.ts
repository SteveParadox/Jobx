import { getDb, type Database } from '@/db';
import * as s from '@/db/schema';
import { admin, employerAccess, type Actor } from '@/lib/auth';
import { env, isProduction } from '@/lib/config';
import { AppError, requireValue } from '@/lib/errors';
import { digest, plainText, publicUrl, sanitizeDescription, slugify } from '@/lib/security';
import { and, desc, eq, gt, isNull, lte, or, sql } from 'drizzle-orm';
import { employerSchema, jobSchema } from './validation';
export type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
export async function audit(
  tx: Tx,
  actorId: string | null,
  action: string,
  entityId: string,
  detail: Record<string, unknown> = {},
) {
  await tx.insert(s.auditLogs).values({ actorId, action, entityId, detail });
}
export async function queueIndex(
  tx: Tx,
  job: typeof s.jobs.$inferSelect,
  type: 'URL_UPDATED' | 'URL_DELETED',
) {
  if (job.isDemo) return;
  await tx
    .insert(s.indexingNotifications)
    .values({ jobId: job.id, type, version: job.version })
    .onConflictDoNothing();
}
export async function invalidateEmployerJobs(
  tx: Tx,
  employerId: string,
  type: 'URL_UPDATED' | 'URL_DELETED',
) {
  const affected = await tx
    .update(s.jobs)
    .set({ version: sql`${s.jobs.version}+1`, updatedAt: new Date() })
    .where(and(eq(s.jobs.employerId, employerId), eq(s.jobs.status, 'active')))
    .returning();
  for (const job of affected) await queueIndex(tx, job, type);
}
export function fingerprint(
  title: string,
  location: string,
  description: string,
  applicationUrl = '',
) {
  return digest(
    [title, location, description, applicationUrl]
      .map((v) => v.toLowerCase().replace(/\s+/g, ' ').trim())
      .join('|'),
  );
}
export async function createEmployer(actor: Actor, input: unknown) {
  const data = employerSchema.parse(input);
  return getDb().transaction(async (tx) => {
    const [company] = await tx
      .insert(s.employers)
      .values({ ...data, slug: `${slugify(data.name)}-${crypto.randomUUID().slice(0, 8)}` })
      .returning();
    await tx
      .insert(s.memberships)
      .values({ employerId: company.id, userId: actor.id, role: 'owner' });
    await audit(tx, actor.id, 'employer.created', company.id);
    return company;
  });
}
export async function jobAllowance(tx: Tx, employerId: string) {
  const subs = await tx
    .select()
    .from(s.subscriptions)
    .where(
      and(
        eq(s.subscriptions.employerId, employerId),
        eq(s.subscriptions.status, 'active'),
        lte(s.subscriptions.startsAt, new Date()),
        gt(s.subscriptions.endsAt, new Date()),
      ),
    );
  return Math.max(1, ...subs.map((v) => v.activeJobs));
}
export async function saveJob(
  actor: Actor,
  employerId: string,
  input: unknown,
  jobId?: string,
  expectedVersion?: number,
) {
  if (actor.role === 'admin') admin(actor);
  else await employerAccess(actor, employerId);
  const data = jobSchema.parse(input);
  const descriptionHtml = sanitizeDescription(data.descriptionHtml);
  const descriptionText = plainText(descriptionHtml);
  if (descriptionText.length < 80)
    throw new AppError(400, 'Please provide a substantive job description');
  const values = {
    ...data,
    descriptionHtml,
    descriptionText,
    slug: slugify(data.title),
    fingerprint: fingerprint(data.title, data.locationLabel, descriptionText, data.applyUrl ?? ''),
    originalPostedAt: data.originalPostedAt ? new Date(data.originalPostedAt) : null,
    expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
  };
  return getDb().transaction(async (tx) => {
    const company = requireValue(
      (await tx.select().from(s.employers).where(eq(s.employers.id, employerId)).for('update'))[0],
    );
    if (!jobId) {
      const [job] = await tx
        .insert(s.jobs)
        .values({ ...values, employerId, isDemo: company.isDemo })
        .returning();
      await audit(tx, actor.id, 'job.created', job.id);
      return job;
    }
    const old = requireValue(
      (
        await tx
          .select()
          .from(s.jobs)
          .where(and(eq(s.jobs.id, jobId), eq(s.jobs.employerId, employerId)))
          .for('update')
      )[0],
    );
    if (old.version !== expectedVersion)
      throw new AppError(409, 'This job changed. Reload before saving.');
    const [job] = await tx
      .update(s.jobs)
      .set({
        ...values,
        slug: old.slug,
        status: old.status === 'active' ? 'pending' : old.status,
        version: old.version + 1,
        updatedAt: new Date(),
      })
      .where(eq(s.jobs.id, jobId))
      .returning();
    await tx
      .insert(s.jobHistory)
      .values({ jobId, actorId: actor.id, change: { type: 'edit', previousVersion: old.version } });
    if (old.status === 'active') {
      await queueIndex(tx, job, 'URL_DELETED');
      await tx
        .update(s.employers)
        .set({ updatedAt: new Date() })
        .where(eq(s.employers.id, employerId));
    }
    await audit(tx, actor.id, 'job.updated', jobId);
    return job;
  });
}
export async function transitionJob(
  actor: Actor,
  jobId: string,
  action: 'submit' | 'publish' | 'close' | 'pause' | 'reject',
) {
  const db = getDb();
  const observed = requireValue((await db.select().from(s.jobs).where(eq(s.jobs.id, jobId)))[0]);
  if (action === 'publish' || action === 'reject') admin(actor);
  else if (actor.role === 'admin') admin(actor);
  else await employerAccess(actor, observed.employerId);
  return db.transaction(async (tx) => {
    const company = requireValue(
      (
        await tx
          .select()
          .from(s.employers)
          .where(eq(s.employers.id, observed.employerId))
          .for('update')
      )[0],
    );
    const job = requireValue(
      (await tx.select().from(s.jobs).where(eq(s.jobs.id, jobId)).for('update'))[0],
    );
    const [sourceMapping] = await tx
      .select({ id: s.mappings.id })
      .from(s.mappings)
      .where(eq(s.mappings.jobId, job.id))
      .limit(1);
    let status: string;
    if (action === 'submit') {
      if (!['draft', 'rejected', 'paused', 'closed', 'expired'].includes(job.status))
        throw new AppError(409, 'This job cannot be submitted from its current state');
      status = 'pending';
    } else if (action === 'publish') {
      if (job.status !== 'pending')
        throw new AppError(409, 'Only reviewed pending jobs can be published');
      if (company.verificationStatus !== 'verified' || company.disabled)
        throw new AppError(409, 'Verify the employer before publication');
      if (job.originalPostedAt && job.originalPostedAt > new Date())
        throw new AppError(409, 'The original posting date cannot be in the future');
      if (job.expiresAt && job.expiresAt <= new Date())
        throw new AppError(409, 'Update the expired deadline before publishing');
      jobSchema.parse({
        ...job,
        originalPostedAt: job.originalPostedAt?.toISOString() ?? null,
        expiresAt: job.expiresAt?.toISOString() ?? null,
        region: job.region ?? undefined,
        city: job.city ?? undefined,
        category: job.category ?? undefined,
        seniority: job.seniority ?? undefined,
        education: job.education ?? undefined,
      });
      const [{ count }] = await tx
        .select({ count: sql<number>`count(*)::integer` })
        .from(s.jobs)
        .where(
          and(
            eq(s.jobs.employerId, company.id),
            eq(s.jobs.status, 'active'),
            or(isNull(s.jobs.expiresAt), gt(s.jobs.expiresAt, new Date())),
            sql`not exists(select 1 from source_job_mappings where job_id=${s.jobs.id})`,
          ),
        );
      if (!sourceMapping && count >= (await jobAllowance(tx, company.id)))
        throw new AppError(402, 'The organization has reached its active job allowance');
      status = 'active';
    } else if (action === 'reject') {
      if (job.status !== 'pending') throw new AppError(409, 'Only pending jobs can be rejected');
      status = 'rejected';
    } else {
      if (!['active', 'pending', 'paused'].includes(job.status))
        throw new AppError(409, 'This job is not open');
      status = action === 'pause' ? 'paused' : 'closed';
    }
    const now = new Date();
    const [updated] = await tx
      .update(s.jobs)
      .set({
        status,
        version: job.version + 1,
        updatedAt: now,
        lastVerifiedAt: status === 'active' ? now : job.lastVerifiedAt,
        originalPostedAt:
          status === 'active'
            ? (job.originalPostedAt ?? (sourceMapping ? null : now))
            : job.originalPostedAt,
        publishedAt: status === 'active' ? (job.publishedAt ?? now) : job.publishedAt,
        closedAt: status === 'closed' ? now : null,
      })
      .where(eq(s.jobs.id, jobId))
      .returning();
    await tx
      .insert(s.jobHistory)
      .values({ jobId, actorId: actor.id, change: { from: job.status, to: status } });
    await queueIndex(tx, updated, status === 'active' ? 'URL_UPDATED' : 'URL_DELETED');
    if (job.status === 'active' || status === 'active')
      await tx.update(s.employers).set({ updatedAt: now }).where(eq(s.employers.id, company.id));
    await audit(tx, actor.id, 'job.' + action, jobId);
    return updated;
  });
}
export async function verifyEmployer(
  actor: Actor,
  employerId: string,
  status: 'verified' | 'rejected',
  evidence: string,
) {
  admin(actor);
  return getDb().transaction(async (tx) => {
    requireValue(
      (
        await tx
          .update(s.employers)
          .set({ verificationStatus: status, updatedAt: new Date() })
          .where(eq(s.employers.id, employerId))
          .returning()
      )[0],
    );
    await tx
      .insert(s.employerVerifications)
      .values({ employerId, reviewerId: actor.id, status, evidence });
    await invalidateEmployerJobs(
      tx,
      employerId,
      status === 'verified' ? 'URL_UPDATED' : 'URL_DELETED',
    );
    await audit(tx, actor.id, 'employer.verification', employerId, { status, evidence });
  });
}
export async function expireJobs() {
  return getDb().transaction(async (tx) => {
    const expired = await tx
      .update(s.jobs)
      .set({
        status: 'expired',
        closedAt: new Date(),
        updatedAt: new Date(),
        version: sql`${s.jobs.version}+1`,
      })
      .where(and(eq(s.jobs.status, 'active'), lte(s.jobs.expiresAt, new Date())))
      .returning();
    for (const job of expired) {
      await queueIndex(tx, job, 'URL_DELETED');
      await tx
        .update(s.employers)
        .set({ updatedAt: new Date() })
        .where(eq(s.employers.id, job.employerId));
    }
    await tx
      .update(s.subscriptions)
      .set({ status: 'expired' })
      .where(and(eq(s.subscriptions.status, 'active'), lte(s.subscriptions.endsAt, new Date())));
    await tx
      .update(s.checkouts)
      .set({ status: 'expired' })
      .where(and(eq(s.checkouts.status, 'pending'), lte(s.checkouts.expiresAt, new Date())));
    return expired.length;
  });
}
export async function myOrganizations(actor: Actor) {
  return getDb()
    .select({ employer: s.employers, role: s.memberships.role })
    .from(s.memberships)
    .innerJoin(s.employers, eq(s.memberships.employerId, s.employers.id))
    .where(eq(s.memberships.userId, actor.id));
}
export async function companyJobs(actor: Actor, employerId: string) {
  await employerAccess(actor, employerId);
  return getDb()
    .select()
    .from(s.jobs)
    .where(eq(s.jobs.employerId, employerId))
    .orderBy(desc(s.jobs.createdAt))
    .limit(200);
}
export async function updateCompany(actor: Actor, id: string, input: unknown) {
  await employerAccess(actor, id, ['owner', 'admin']);
  const data = employerSchema.parse(input);
  return getDb().transaction(async (tx) => {
    const [old] = await tx.select().from(s.employers).where(eq(s.employers.id, id)).for('update');
    const verificationStatus =
      old.website === publicUrl(data.website) && old.name === data.name
        ? old.verificationStatus
        : 'pending';
    const [updated] = await tx
      .update(s.employers)
      .set({ ...data, verificationStatus, updatedAt: new Date() })
      .where(eq(s.employers.id, id))
      .returning();
    await invalidateEmployerJobs(
      tx,
      id,
      verificationStatus === 'verified' ? 'URL_UPDATED' : 'URL_DELETED',
    );
    await audit(tx, actor.id, 'employer.updated', id);
    return updated;
  });
}
export const applicationStages = [
  'new',
  'reviewing',
  'shortlisted',
  'interview',
  'offer',
  'hired',
  'rejected',
  'withdrawn',
] as const;
export async function submitApplication(
  actor: Actor,
  input: { jobId: string; resumeId?: string; coverLetter: string },
) {
  return getDb().transaction(async (tx) => {
    const job = requireValue(
      (await tx.select().from(s.jobs).where(eq(s.jobs.id, input.jobId)).for('update'))[0],
    );
    const company = requireValue(
      (await tx.select().from(s.employers).where(eq(s.employers.id, job.employerId)))[0],
    );
    if (
      job.status !== 'active' ||
      (job.expiresAt && job.expiresAt <= new Date()) ||
      company.disabled ||
      company.verificationStatus !== 'verified' ||
      ((isProduction || !env.DEMO_MODE) && (job.isDemo || company.isDemo))
    )
      throw new AppError(409, 'This job is no longer accepting applications');
    if (job.applicationMethod !== 'native')
      throw new AppError(400, 'Apply through the employer website for this vacancy');
    if (job.resumeRequired && !input.resumeId)
      throw new AppError(400, 'This employer requires a clean résumé with the application');
    if (input.resumeId) {
      const resume = requireValue(
        (
          await tx
            .select()
            .from(s.resumes)
            .where(and(eq(s.resumes.id, input.resumeId), eq(s.resumes.userId, actor.id)))
        )[0],
      );
      if (resume.status !== 'clean')
        throw new AppError(409, 'Your résumé must clear security review before use');
    }
    const [application] = await tx
      .insert(s.applications)
      .values({ ...input, userId: actor.id, kind: 'native', status: 'new' })
      .onConflictDoNothing()
      .returning();
    if (!application) throw new AppError(409, 'You have already applied to this vacancy');
    await tx
      .insert(s.applicationEvents)
      .values({ applicationId: application.id, actorId: actor.id, status: 'new', internal: false });
    await tx.insert(s.notifications).values({
      userId: actor.id,
      title: 'Application submitted',
      body: `Your application to ${job.title} was received.`,
      href: '/dashboard',
      dedupeKey: 'application:' + application.id,
    });
    await tx.insert(s.deliveries).values({
      userId: actor.id,
      to: actor.email,
      subject: 'Application received',
      body: `<p>Your application to ${plainText(job.title).replace(/[<>&]/g, '')} was received. View your dashboard for status updates.</p>`,
      dedupeKey: 'application:' + application.id,
    });
    return application;
  });
}
export async function updateApplication(
  actor: Actor,
  id: string,
  status: (typeof applicationStages)[number],
  note?: string,
) {
  const app = requireValue(
    (
      await getDb()
        .select({ application: s.applications, job: s.jobs })
        .from(s.applications)
        .innerJoin(s.jobs, eq(s.applications.jobId, s.jobs.id))
        .where(eq(s.applications.id, id))
    )[0],
  );
  if (actor.id === app.application.userId) {
    if (status !== 'withdrawn' || note)
      throw new AppError(403, 'Candidates may only withdraw their own application');
  } else await employerAccess(actor, app.job.employerId);
  return getDb().transaction(async (tx) => {
    const current = requireValue(
      (await tx.select().from(s.applications).where(eq(s.applications.id, id)).for('update'))[0],
    );
    if (current.status === 'withdrawn' && status !== 'withdrawn')
      throw new AppError(409, 'A withdrawn application cannot be advanced by an employer');
    await tx
      .update(s.applications)
      .set({ status, updatedAt: new Date() })
      .where(eq(s.applications.id, id));
    await tx.insert(s.applicationEvents).values({
      applicationId: id,
      actorId: actor.id,
      status,
      note,
      internal: actor.id !== app.application.userId,
    });
    await audit(tx, actor.id, 'application.status', id, { status });
  });
}
export async function employerApplications(actor: Actor, employerId: string) {
  await employerAccess(actor, employerId);
  return getDb()
    .select({
      application: s.applications,
      title: s.jobs.title,
      candidate: { id: s.user.id, name: s.user.name, email: s.user.email },
    })
    .from(s.applications)
    .innerJoin(s.jobs, eq(s.applications.jobId, s.jobs.id))
    .innerJoin(s.user, eq(s.applications.userId, s.user.id))
    .where(and(eq(s.jobs.employerId, employerId), eq(s.applications.kind, 'native')))
    .orderBy(desc(s.applications.createdAt))
    .limit(200);
}
export async function auditApplicationAccess(actor: Actor, applicationId: string) {
  const app = requireValue(
    (
      await getDb()
        .select({ application: s.applications, employerId: s.jobs.employerId })
        .from(s.applications)
        .innerJoin(s.jobs, eq(s.applications.jobId, s.jobs.id))
        .where(eq(s.applications.id, applicationId))
    )[0],
  );
  if (app.application.userId !== actor.id) await employerAccess(actor, app.employerId);
  return app;
}

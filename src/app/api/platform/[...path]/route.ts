import { getDb } from '@/db';
import * as s from '@/db/schema';
import { adminOverview, disableEmployer, seoHealth } from '@/domain/admin';
import { cancelSubscription, checkout, reconcilePayment } from '@/domain/billing';
import {
  candidateDashboard,
  clearSearchHistory,
  createAlert,
  exportCandidateData,
  markAllNotificationsRead,
  markNotification,
  recommendations,
  recordSearch,
  saveSearch,
  toggleSaved,
  trackExternal,
  unsubscribe,
  updateAlert,
  updateCandidatePreferences,
} from '@/domain/candidates';
import { controlIngestionTask, enqueueSource, ingestionOverview } from '@/domain/ingestion-tasks';
import {
  applicationStages,
  audit,
  auditApplicationAccess,
  companyJobs,
  createEmployer,
  employerApplications,
  myOrganizations,
  saveJob,
  submitApplication,
  transitionJob,
  updateApplication,
  updateCompany,
  verifyEmployer,
} from '@/domain/jobs';
import { searchJobs, suggestions } from '@/domain/search';
import { registerSource, reviewSource, updateSource } from '@/domain/source-management';
import { runConfiguredSeedDiscovery } from '@/domain/discovery/discovery-service';
import { acceptInvite, invite, removeMember } from '@/domain/team';
import { savedSearchSchema } from '@/domain/validation';
import { removeResume, queueResumeCleanup, resumeAccess } from '@/integrations/storage';
import { admin, currentActor, employerAccess, requireActor } from '@/lib/auth';
import { env } from '@/lib/config';
import { AppError, requireValue } from '@/lib/errors';
import { body, clientAddress, endpoint, rateLimit, sameOrigin } from '@/lib/http';
import { queueHealth } from '@/lib/queue';
import { digest, sanitizeDescription } from '@/lib/security';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
const uuid = (v: string) => z.uuid().parse(v);
async function handler(req: Request, context: { params: Promise<{ path: string[] }> }) {
  return endpoint(async () => {
    const { path: p } = await context.params;
    const path = p.join('/');
    const method = req.method;
    const db = getDb();
    if (method === 'POST' && path === 'events') {
      sameOrigin(req);
      if (!env.ANALYTICS_ENABLED) return { recorded: false };
      const data = await body(
        req,
        z.object({
          event: z.enum([
            'job_detail_viewed',
            'search_results_viewed',
            'filters_applied',
            'external_apply_clicked',
            'search_submitted',
          ]),
          jobId: z.uuid().optional(),
          consent: z.literal(true),
          properties: z
            .object({ hasQuery: z.boolean().optional(), filtered: z.boolean().optional() })
            .default({}),
        }),
      );
      await rateLimit('analytics:' + clientAddress(req), 60, 60);
      await db
        .insert(s.analytics)
        .values({ event: data.event, jobId: data.jobId, properties: data.properties });
      return { recorded: true };
    }
    if (method !== 'GET') {
      sameOrigin(req);
      await rateLimit(
        'request:' + clientAddress(req),
        60,
        60,
      );
    }
    if (method === 'GET' && path === 'jobs') {
      await rateLimit('search:' + clientAddress(req), 120, 60);
      return searchJobs(Object.fromEntries(new URL(req.url).searchParams));
    }
    if (method === 'GET' && path === 'suggestions') {
      await rateLimit('suggestions:' + clientAddress(req), 120, 60);
      return suggestions(new URL(req.url).searchParams.get('q') ?? '');
    }
    if (method === 'GET' && path === 'plans')
      return {
        plans: await db.select().from(s.plans).where(eq(s.plans.enabled, true)),
        providers: {
          stripe: Boolean(env.STRIPE_SECRET_KEY),
          paystack: Boolean(env.PAYSTACK_SECRET_KEY),
        },
      };
    if (method === 'POST' && path === 'contact') {
      const data = await body(
        req,
        z.object({
          email: z.email(),
          subject: z.string().min(3).max(160),
          body: z.string().min(20).max(5000),
        }),
      );
      await rateLimit('contact:' + digest(data.email), 3, 3600);
      await db.insert(s.supportRequests).values(data);
      return { message: 'Your message was received.' };
    }
    if (method === 'POST' && path === 'report') {
      const data = await body(
        req,
        z.object({ jobId: z.uuid(), reason: z.string().min(10).max(2000) }),
      );
      await rateLimit('report:' + data.jobId, 20, 3600);
      const actor = await currentActor(req);
      await db.insert(s.jobReports).values({ ...data, reporterId: actor?.id });
      return { message: 'The report was submitted for review.' };
    }
    if (method === 'POST' && path === 'unsubscribe') {
      const data = await body(req, z.object({ token: z.string().min(20).max(200) }));
      await unsubscribe(data.token);
      return { message: 'This alert is disabled.' };
    }
    if (method === 'POST' && path === 'search-history') {
      const filters = await body(req, z.unknown());
      const actor = await currentActor(req);
      if (!actor?.emailVerified) return { recorded: false };
      await rateLimit('history:' + actor.id, 30, 60);
      return recordSearch(actor, filters);
    }
    const actor = await requireActor(req);
    if (method !== 'GET') await rateLimit('actor:' + actor.id, 60, 60);
    if (method === 'GET' && path === 'me')
      return { id: actor.id, name: actor.name, email: actor.email, role: actor.role };
    if (method === 'GET' && path === 'dashboard') return candidateDashboard(actor);
    if (method === 'GET' && p[0] === 'saved-jobs' && p.length === 2) {
      const [saved] = await db.select({ jobId: s.savedJobs.jobId })
        .from(s.savedJobs)
        .where(and(eq(s.savedJobs.userId, actor.id), eq(s.savedJobs.jobId, uuid(p[1]))))
        .limit(1);
      return { saved: Boolean(saved) };
    }
    if (method === 'GET' && path === 'resumes/eligible') {
      return db.select({ id: s.resumes.id, filename: s.resumes.filename })
        .from(s.resumes)
        .where(and(eq(s.resumes.userId, actor.id), eq(s.resumes.status, 'clean')))
        .orderBy(desc(s.resumes.createdAt))
        .limit(50);
    }

    if (method === 'PUT' && path === 'preferences')
      return updateCandidatePreferences(actor, await body(req, z.unknown()));
    if (method === 'DELETE' && p[0] === 'search-history' && p.length <= 2)
      return clearSearchHistory(actor, p[1] ? uuid(p[1]) : undefined);
    if (method === 'POST' && path === 'notifications/read-all')
      return markAllNotificationsRead(actor);
    if (method === 'PATCH' && p[0] === 'notifications' && p.length === 2) {
      const data = await body(req, z.object({ read: z.boolean() }));
      return markNotification(actor, uuid(p[1]), data.read);
    }
    if (method === 'GET' && path === 'recommendations') return recommendations(actor);
    if (method === 'GET' && path === 'export')
      return new Response(JSON.stringify(await exportCandidateData(actor), null, 2), {
        headers: {
          'Content-Type': 'application/json',
          'Content-Disposition': 'attachment; filename="careeratlas-data.json"',
          'Cache-Control': 'no-store',
        },
      });
    if (method === 'POST' && path === 'account/delete') {
      const data = await body(req, z.object({ confirmation: z.literal('DELETE') }));
      void data;
      await db.transaction(async (tx) => {
        // Lock account before checking ownership. Employer creation takes the same lock.
        const [account] = await tx.select({ disabled: s.user.disabled })
          .from(s.user).where(eq(s.user.id, actor.id)).for('update');
        if (!account || account.disabled)
          throw new AppError(409, 'Account is no longer active');
        const owned = await tx.select({ employerId: s.memberships.employerId })
          .from(s.memberships)
          .where(and(eq(s.memberships.userId, actor.id), eq(s.memberships.role, 'owner')));
        if (owned.length)
          throw new AppError(
            409,
            'Transfer organization ownership through support before deleting your account',
          );
        const documents = await tx.select({ id: s.resumes.id, objectKey: s.resumes.objectKey })
          .from(s.resumes).where(eq(s.resumes.userId, actor.id)).for('update');
        await queueResumeCleanup(tx, documents);
        await tx.delete(s.session).where(eq(s.session.userId, actor.id));
        await tx.delete(s.account).where(eq(s.account.userId, actor.id));
        await tx.delete(s.profiles).where(eq(s.profiles.userId, actor.id));
        await tx.delete(s.alerts).where(eq(s.alerts.userId, actor.id));
        await tx.delete(s.savedJobs).where(eq(s.savedJobs.userId, actor.id));
        await tx.delete(s.savedSearches).where(eq(s.savedSearches.userId, actor.id));
        await tx.delete(s.searchHistory).where(eq(s.searchHistory.userId, actor.id));
        await tx.delete(s.candidatePreferences).where(eq(s.candidatePreferences.userId, actor.id));
        await tx.delete(s.resumes).where(eq(s.resumes.userId, actor.id));
        await tx.delete(s.applications).where(eq(s.applications.userId, actor.id));
        await tx.delete(s.notifications).where(eq(s.notifications.userId, actor.id));
        await tx.delete(s.deliveries).where(eq(s.deliveries.userId, actor.id));
        await tx.delete(s.memberships).where(eq(s.memberships.userId, actor.id));
        await tx
          .update(s.user)
          .set({
            name: 'Deleted user',
            email: `deleted-${actor.id}@example.invalid`,
            image: null,
            disabled: true,
            updatedAt: new Date(),
          })
          .where(eq(s.user.id, actor.id));
        await audit(tx, actor.id, 'account.erased', actor.id);
      });
      return {
        message:
          'Your account has been disabled and personal records erased. Private document deletion is queued for durable background cleanup. Required accounting and audit records remain under the retention policy.',
      };
    }
    if (method === 'PUT' && path === 'profile') {
      const data = await body(
        req,
        z.object({
          headline: z.string().max(200),
          country: z.string().length(2).nullable(),
          skills: z.array(z.string().max(60)).max(50),
          experience: z
            .array(
              z.object({
                company: z.string().max(200),
                role: z.string().max(200),
                description: z.string().max(3000),
              }),
            )
            .max(30),
          education: z
            .array(
              z.object({ institution: z.string().max(200), qualification: z.string().max(200) }),
            )
            .max(20),
          emailConsent: z.boolean(),
          aiConsent: z.boolean(),
        }),
      );
      await db
        .insert(s.profiles)
        .values({ ...data, userId: actor.id })
        .onConflictDoUpdate({ target: s.profiles.userId, set: { ...data, updatedAt: new Date() } });
      return { saved: true };
    }
    if (method === 'POST' && path === 'saved-jobs') {
      const data = await body(req, z.object({ jobId: z.uuid(), save: z.boolean() }));
      return toggleSaved(actor, data.jobId, data.save);
    }
    if (method === 'POST' && path === 'alerts')
      return createAlert(actor, await body(req, z.unknown()));
    if (method === 'DELETE' && p[0] === 'alerts' && p.length === 2) {
      const [removed] = await db
        .delete(s.alerts)
        .where(and(eq(s.alerts.id, uuid(p[1])), eq(s.alerts.userId, actor.id)))
        .returning({ id: s.alerts.id });
      requireValue(removed);
      return { deleted: true };
    }
    if (method === 'PATCH' && p[0] === 'alerts' && p.length === 2)
      return updateAlert(actor, uuid(p[1]), await body(req, z.unknown()));
    if (
      (method === 'POST' && path === 'saved-searches') ||
      (method === 'PATCH' && p[0] === 'saved-searches' && p.length === 2)
    ) {
      const data = await body(req, savedSearchSchema);
      return saveSearch(
        actor,
        data.name,
        data.filters,
        method === 'PATCH' ? uuid(p[1]) : undefined,
      );
    }
    if (method === 'DELETE' && p[0] === 'saved-searches' && p.length === 2) {
      const [removed] = await db
        .delete(s.savedSearches)
        .where(and(eq(s.savedSearches.id, uuid(p[1])), eq(s.savedSearches.userId, actor.id)))
        .returning({ id: s.savedSearches.id });
      requireValue(removed);
      return { deleted: true };
    }
    if (method === 'POST' && path === 'applications')
      return submitApplication(
        actor,
        await body(
          req,
          z.object({
            jobId: z.uuid(),
            resumeId: z.uuid().optional(),
            coverLetter: z.string().max(10000).default(''),
          }),
        ),
      );
    if (method === 'POST' && path === 'external-activity') {
      const data = await body(
        req,
        z.object({ jobId: z.uuid(), status: z.enum(['clicked_external', 'applied_external']) }),
      );
      return trackExternal(actor, data.jobId, data.status);
    }
    if (method === 'PATCH' && p[0] === 'applications') {
      const data = await body(
        req,
        z.object({ status: z.enum(applicationStages), note: z.string().max(4000).optional() }),
      );
      await updateApplication(actor, uuid(p[1]), data.status, data.note);
      return { saved: true };
    }
    if (method === 'GET' && p[0] === 'applications' && p[2] === 'events') {
      const app = await auditApplicationAccess(actor, uuid(p[1]));
      return db
        .select()
        .from(s.applicationEvents)
        .where(
          and(
            eq(s.applicationEvents.applicationId, p[1]),
            ...(app.application.userId === actor.id
              ? [eq(s.applicationEvents.internal, false)]
              : []),
          ),
        );
    }
    if (method === 'GET' && p[0] === 'resumes') {
      return { url: await resumeAccess(actor, uuid(p[1])) };
    }
    if (method === 'DELETE' && p[0] === 'resumes') {
      await removeResume(actor, uuid(p[1]));
      return { deleted: true };
    }
    if (method === 'GET' && path === 'employers') return myOrganizations(actor);
    if (method === 'POST' && path === 'employers')
      return createEmployer(actor, await body(req, z.unknown()));
    if (method === 'PUT' && p[0] === 'employers' && p.length === 2)
      return updateCompany(actor, uuid(p[1]), await body(req, z.unknown()));
    if (p[0] === 'employers' && p[2] === 'jobs') {
      const employerId = uuid(p[1]);
      if (method === 'GET') return companyJobs(actor, employerId);
      if (method === 'POST') return saveJob(actor, employerId, await body(req, z.unknown()));
      if (method === 'PUT') {
        const data = await body(
          req,
          z.object({ job: z.unknown(), expectedVersion: z.number().int() }),
        );
        return saveJob(actor, employerId, data.job, uuid(p[3]), data.expectedVersion);
      }
    }
    if (p[0] === 'jobs' && p[2] === 'transition' && method === 'POST') {
      const data = await body(
        req,
        z.object({ action: z.enum(['submit', 'publish', 'pause', 'close', 'reject']) }),
      );
      return transitionJob(actor, uuid(p[1]), data.action);
    }
    if (p[0] === 'employers' && p[2] === 'applications' && method === 'GET')
      return employerApplications(actor, uuid(p[1]));
    if (p[0] === 'employers' && p[2] === 'team') {
      const employerId = uuid(p[1]);
      await employerAccess(actor, employerId, ['owner', 'admin']);
      if (method === 'GET')
        return db
          .select({
            userId: s.user.id,
            name: s.user.name,
            email: s.user.email,
            role: s.memberships.role,
          })
          .from(s.memberships)
          .innerJoin(s.user, eq(s.memberships.userId, s.user.id))
          .where(eq(s.memberships.employerId, employerId));
      if (method === 'POST') {
        const data = await body(
          req,
          z.object({ email: z.email(), role: z.enum(['admin', 'recruiter', 'viewer']) }),
        );
        return invite(actor, employerId, data.email, data.role);
      }
      if (method === 'DELETE') {
        await removeMember(actor, employerId, p[3]);
        return { deleted: true };
      }
    }
    if (method === 'POST' && path === 'invitations/accept') {
      const data = await body(req, z.object({ token: z.string().max(200) }));
      return acceptInvite(actor, data.token);
    }
    if (p[0] === 'employers' && p[2] === 'billing' && method === 'GET') {
      await employerAccess(actor, uuid(p[1]), ['owner', 'admin']);
      return {
        subscriptions: await db
          .select()
          .from(s.subscriptions)
          .where(eq(s.subscriptions.employerId, p[1])),
        invoices: await db.select().from(s.invoices).where(eq(s.invoices.employerId, p[1])),
        checkouts: await db
          .select()
          .from(s.checkouts)
          .where(eq(s.checkouts.employerId, p[1]))
          .orderBy(desc(s.checkouts.createdAt))
          .limit(50),
      };
    }
    if (p[0] === 'employers' && p[2] === 'metrics' && method === 'GET')
      return (await import('@/domain/metrics')).employerMetrics(actor, uuid(p[1]));
    if (p[0] === 'employers' && p[2] === 'feature' && method === 'POST') {
      const data = await body(
        req,
        z.object({ jobId: z.uuid(), days: z.number().int().min(1).max(30) }),
      );
      return (await import('@/domain/metrics')).featureJob(
        actor,
        uuid(p[1]),
        data.jobId,
        data.days,
      );
    }
    if (path === 'checkout' && method === 'POST') {
      const data = await body(
        req,
        z.object({
          employerId: z.uuid(),
          planId: z.string(),
          provider: z.enum(['stripe', 'paystack']),
        }),
      );
      return checkout(actor, data.employerId, data.planId, data.provider);
    }
    if (p[0] === 'checkout' && p[2] === 'reconcile' && method === 'POST')
      return reconcilePayment(actor, uuid(p[1]));
    if (p[0] === 'subscriptions' && p[2] === 'cancel' && method === 'POST')
      return cancelSubscription(actor, uuid(p[1]));
    if (p[0] === 'admin') {
      admin(actor);
      if (method === 'GET' && path === 'admin/metrics')
        return (await import('@/domain/metrics')).platformMetrics(actor);
      if (method === 'GET' && path === 'admin/overview') return adminOverview(actor);
      if (method === 'GET' && path === 'admin/ingestion')
        return { ...(await ingestionOverview()), queue: await queueHealth() };
      if (method === 'GET' && path === 'admin/discovery') {
        const [candidates, runs] = await Promise.all([
          db.select().from(s.discoveryCandidates).orderBy(desc(s.discoveryCandidates.lastObservedAt)).limit(200),
          db.select().from(s.discoveryRuns).orderBy(desc(s.discoveryRuns.startedAt)).limit(50),
        ]);
        return { candidates, runs, configured: Boolean(env.JOB_DISCOVERY_ENABLED && env.JOB_DISCOVERY_SEEDS) };
      }
      if (method === 'POST' && path === 'admin/discovery/run') {
        const data = await body(req, z.object({ seeds: z.string().max(10000).optional() }));
        return runConfiguredSeedDiscovery(data.seeds ?? env.JOB_DISCOVERY_SEEDS ?? '', 15, new Date(), true);
      }
      if (method === 'POST' && p[1] === 'discovery' && p[3] === 'source-draft' && p.length === 4) {
        const data = await body(req, z.object({
          employerId: z.uuid(),
          permissionEvidence: z.string().trim().min(20).max(10000),
          attribution: z.string().trim().min(2).max(500),
          permittedFields: z.array(z.enum(['title', 'description', 'location', 'application', 'date', 'salary', 'skills', 'employment', 'experience'])).min(1),
          removalPolicy: z.string().trim().min(10).max(2000),
          intervalMinutes: z.number().int().min(15).max(10080).default(60),
          applicationHostnames: z.array(z.string().trim().toLowerCase().min(3).max(250)).min(1).max(20),
          usageConditions: z.string().trim().min(10).max(5000),
          authorizationExpiresAt: z.iso.datetime().nullable().optional(),
        }));
        const candidate = requireValue(
          (await db.select().from(s.discoveryCandidates).where(eq(s.discoveryCandidates.id, uuid(p[2]))))[0],
        );
        if (candidate.state !== 'IDENTIFIED' || !candidate.reviewedAt)
          throw new AppError(409, 'Identify and review the candidate before creating a source draft');
        if (!candidate.provider || !candidate.boardToken)
          throw new AppError(409, 'This candidate has no supported ATS board identity; use the authorized manual-source workflow');
        const employer = requireValue(
          (await db.select().from(s.employers).where(eq(s.employers.id, data.employerId)))[0],
        );
        if (employer.disabled || employer.verificationStatus !== 'verified')
          throw new AppError(409, 'Verify the employer before creating a source draft');
        const source = await registerSource(actor, {
          ...data,
          provider: candidate.provider,
          boardToken: candidate.boardToken,
          enabled: false,
          autoPublish: false,
        });
        await db.transaction(async (tx) => {
          await audit(tx, actor.id, 'discovery.source_draft_created', source.id, {
            candidateId: candidate.id,
            employerId: employer.id,
            provider: candidate.provider,
          });
        });
        return { source, enabled: false, approvalStatus: 'pending', candidateId: candidate.id };
      }
      if (method === 'PATCH' && p[1] === 'discovery' && p.length === 3) {
        const data = await body(req, z.object({
          state: z.enum(['IDENTIFIED', 'REVIEW_REQUIRED', 'REJECTED']),
          note: z.string().trim().min(10).max(2000),
        }));
        return db.transaction(async (tx) => {
          const [candidate] = await tx.update(s.discoveryCandidates).set({
            state: data.state,
            requiresPermissionReview: true,
            reviewedAt: new Date(),
            reviewedBy: actor.id,
            reviewNote: data.note,
          }).where(eq(s.discoveryCandidates.id, uuid(p[2]))).returning({ id: s.discoveryCandidates.id });
          if (!candidate) throw new AppError(404, 'Discovery candidate not found');
          await audit(tx, actor.id, 'discovery.candidate_reviewed', candidate.id, { state: data.state, note: data.note });
          return { reviewed: true, id: candidate.id, state: data.state };
        });
      }
      if (
        method === 'POST' &&
        p[1] === 'ingestion-tasks' &&
        p.length === 4 &&
        ['cancel', 'retry'].includes(p[3])
      )
        return controlIngestionTask(actor, uuid(p[2]), p[3] as 'cancel' | 'retry');
      if (method === 'GET' && path === 'admin/seo') return seoHealth(actor);
      if (method === 'POST' && p[1] === 'checkout' && p[3] === 'reconcile') {
        const attempt = requireValue(
          (
            await db
              .select()
              .from(s.checkouts)
              .where(eq(s.checkouts.id, uuid(p[2])))
          )[0],
        );
        if (!attempt.providerReference)
          throw new AppError(409, 'Checkout initialization is incomplete');
        const { verifyPayment } = await import('@/integrations/payments');
        const { settlePayment } = await import('@/domain/billing');
        return settlePayment(
          await verifyPayment(attempt.provider as 'stripe' | 'paystack', attempt.providerReference),
        );
      }
      if (method === 'POST' && path === 'admin/import') {
        const data = await body(
          req,
          z.object({
            sourceId: z.uuid(),
            format: z.enum(['json', 'csv', 'xml']),
            content: z.string().max(180000),
            completeSnapshot: z.literal(true),
          }),
        );
        const source = requireValue(
          (await db.select().from(s.sources).where(eq(s.sources.id, data.sourceId)))[0],
        );
        if (!source.enabled)
          throw new AppError(409, 'Enable the authorized source before importing');
        if (source.provider !== 'manual_' + data.format)
          throw new AppError(400, 'Import format must match the authorized source');
        const { parseAuthorizedImport } = await import('@/integrations/imports');
        const records = parseAuthorizedImport(data.format, data.content);
        return {
          ...(await enqueueSource(actor, source.id, 'import', records)),
          count: records.length,
        };
      }
      if (method === 'POST' && path === 'admin/sources') {
        return registerSource(actor, await body(req, z.unknown()));
      }
      if (method === 'PUT' && p[1] === 'sources' && p.length === 3)
        return updateSource(actor, uuid(p[2]), await body(req, z.unknown()));
      if (method === 'POST' && p[1] === 'sources' && p[3] === 'review' && p.length === 4) {
        const data = await body(
          req,
          z.object({
            status: z.enum(['approved', 'revoked']),
            evidence: z.string().min(20).max(5000),
          }),
        );
        return reviewSource(actor, uuid(p[2]), data.status, data.evidence);
      }
      if (method === 'PATCH' && p[1] === 'sources' && p.length === 3) {
        const data = await body(req, z.object({ enabled: z.boolean() }));
        await (
          await import('@/domain/ingestion')
        ).setSourceEnabled(actor.id, uuid(p[2]), data.enabled);
        return { saved: true };
      }
      if (
        method === 'POST' &&
        p[1] === 'sources' &&
        p.length === 4 &&
        ['sync', 'test'].includes(p[3])
      )
        return enqueueSource(actor, uuid(p[2]), p[3] as 'sync' | 'test');
      if (method === 'POST' && p[1] === 'employers' && p[3] === 'verify') {
        const data = await body(
          req,
          z.object({
            status: z.enum(['verified', 'rejected']),
            evidence: z.string().min(20).max(5000),
          }),
        );
        await verifyEmployer(actor, uuid(p[2]), data.status, data.evidence);
        return { saved: true };
      }
      if (method === 'PATCH' && p[1] === 'employers') {
        const data = await body(req, z.object({ disabled: z.boolean() }));
        await disableEmployer(actor, uuid(p[2]), data.disabled);
        return { saved: true };
      }
      if (method === 'PATCH' && p[1] === 'users') {
        const data = await body(req, z.object({ disabled: z.boolean() }));
        if (p[2] === actor.id)
          throw new AppError(409, 'You cannot disable your own administrator account');
        await db.transaction(async (tx) => {
          await tx.update(s.user).set(data).where(eq(s.user.id, p[2]));
          if (data.disabled) await tx.delete(s.session).where(eq(s.session.userId, p[2]));
          await audit(tx, actor.id, 'user.disabled', p[2], data);
        });
        return { saved: true };
      }
      if (method === 'PATCH' && p[1] === 'reports') {
        const data = await body(req, z.object({ resolution: z.string().min(10).max(2000) }));
        await db.transaction(async (tx) => {
          await tx
            .update(s.jobReports)
            .set({ status: 'resolved', resolution: data.resolution })
            .where(eq(s.jobReports.id, uuid(p[2])));
          await audit(tx, actor.id, 'report.resolved', p[2], data);
        });
        return { saved: true };
      }
      if (method === 'POST' && path === 'admin/landings') {
        const { landingSchema } = await import('@/domain/landings');
        const data = await body(
          req,
          z.object({
            path: z.string().regex(/^\/jobs\/[a-z0-9-]+(?:\/[a-z0-9-]+){0,2}$/),
            content: landingSchema,
          }),
        );
        await db
          .insert(s.settings)
          .values({
            key: 'landing:' + data.path,
            value: { ...data.content, bodyHtml: sanitizeDescription(data.content.bodyHtml) },
          })
          .onConflictDoUpdate({
            target: s.settings.key,
            set: {
              value: { ...data.content, bodyHtml: sanitizeDescription(data.content.bodyHtml) },
              updatedAt: new Date(),
            },
          });
        return { saved: true };
      }
      if (method === 'POST' && p[1] === 'editorial') {
        const data = await body(
          req,
          z.object({
            slug: z.string().regex(/^[a-z0-9-]{2,100}$/),
            title: z.string().min(5).max(200),
            summary: z.string().min(30).max(300),
            bodyHtml: z.string().min(100).max(100000),
            published: z.boolean(),
            author: z.string().min(2).max(100),
          }),
        );
        return (
          await db
            .insert(s.editorial)
            .values({ ...data, bodyHtml: sanitizeDescription(data.bodyHtml) })
            .onConflictDoUpdate({
              target: s.editorial.slug,
              set: { ...data, bodyHtml: sanitizeDescription(data.bodyHtml), updatedAt: new Date() },
            })
            .returning()
        )[0];
      }
      if (method === 'POST' && p[1] === 'resumes' && p[3] === 'review') {
        const data = await body(
          req,
          z.object({
            status: z.enum(['clean', 'rejected']),
            evidence: z.string().min(30).max(5000),
          }),
        );
        await db.transaction(async (tx) => {
          await tx
            .update(s.resumes)
            .set({ status: data.status })
            .where(eq(s.resumes.id, uuid(p[2])));
          await audit(tx, actor.id, 'resume.reviewed', p[2], data);
        });
        return { saved: true };
      }
      if (method === 'PATCH' && p[1] === 'support') {
        await db
          .update(s.supportRequests)
          .set({ status: 'resolved' })
          .where(eq(s.supportRequests.id, uuid(p[2])));
        return { saved: true };
      }
    }
    throw new AppError(404, 'Endpoint not found');
  });
}
export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;

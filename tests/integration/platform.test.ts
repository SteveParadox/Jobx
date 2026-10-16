import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as s from '../../src/db/schema';
import { settlePayment, validateSettlement } from '../../src/domain/billing';
import {
  candidateDashboard,
  createAlert,
  exportCandidateData,
  toggleSaved,
  trackExternal,
  unsubscribe,
} from '../../src/domain/candidates';
import { syncSource } from '../../src/domain/ingestion';
import {
  createEmployer,
  employerApplications,
  expireJobs,
  jobAllowance,
  saveJob,
  submitApplication,
  transitionJob,
  updateApplication,
  verifyEmployer,
} from '../../src/domain/jobs';
import { deliverNotification, generateDigests } from '../../src/domain/notifications';
import { getPublicJob, searchJobs, suggestions } from '../../src/domain/search';
import { acceptInvite } from '../../src/domain/team';
import { employerAccess } from '../../src/lib/auth';
import { digest } from '../../src/lib/security';
import { actor, description, jobInput, testDatabase } from '../helpers';
vi.mock('../../src/lib/email', () => ({ sendEmail: vi.fn(async () => 'email-provider-id') }));
let ctx: Awaited<ReturnType<typeof testDatabase>>;
const owner = actor('owner');
const candidate = actor('candidate');
const root = actor('root', 'admin');
const stranger = actor('stranger');
let employerId: string;
beforeAll(async () => {
  ctx = await testDatabase();
});
afterAll(async () => {
  await ctx.client.close();
});
beforeEach(async () => {
  await ctx.client.exec('TRUNCATE users, employers RESTART IDENTITY CASCADE');
  for (const a of [owner, candidate, root, stranger]) await ctx.db.insert(s.user).values(a);
  employerId = (
    await createEmployer(owner, {
      name: 'Fixture Employer',
      website: 'https://careers.example.com',
      description: 'Explicit test employer, never a live job source.',
    })
  ).id;
  await verifyEmployer(
    root,
    employerId,
    'verified',
    'Fixture identity evidence for integration tests only.',
  );
  vi.clearAllMocks();
});
async function draft(overrides: Record<string, unknown> = {}) {
  return saveJob(owner, employerId, { ...jobInput, ...overrides });
}
async function publish(overrides: Record<string, unknown> = {}) {
  const j = await draft(overrides);
  await transitionJob(owner, j.id, 'submit');
  return transitionJob(root, j.id, 'publish');
}
function greenhouseRows(ids: number[]) {
  return {
    jobs: ids.map((id) => ({
      id,
      title: 'Source Engineer ' + id,
      absolute_url: `https://careers.example.com/jobs/${id}`,
      content: description,
      location: { name: 'Lagos, Nigeria' },
    })),
  };
}
async function source() {
  return (
    await ctx.db
      .insert(s.sources)
      .values({
        employerId,
        provider: 'greenhouse',
        boardToken: 'fixture',
        permissionEvidence: 'Test permission covering all displayed fields only.',
        attribution: 'Fixture ATS',
        removalPolicy: 'Remove confirmed closed listings',
        permittedFields: ['title', 'description', 'location', 'application', 'date'],
        enabled: true,
      })
      .returning()
  )[0];
}
const fetchRows = (payload: unknown) =>
  vi.fn(
    async () =>
      new Response(JSON.stringify(payload), { headers: { 'Content-Type': 'application/json' } }),
  ) as unknown as typeof fetch;
describe('employers and moderation', () => {
  it('provisions an organization and ownership atomically', async () => {
    const [membership] = await ctx.db
      .select()
      .from(s.memberships)
      .where(eq(s.memberships.employerId, employerId));
    expect(membership.userId).toBe(owner.id);
    expect(membership.role).toBe('owner');
  });
  it('requires administrator approval to publish', async () => {
    const j = await draft();
    await transitionJob(owner, j.id, 'submit');
    await expect(transitionJob(owner, j.id, 'publish')).rejects.toMatchObject({ status: 403 });
  });
  it('rejects unverified employers', async () => {
    await ctx.db
      .update(s.employers)
      .set({ verificationStatus: 'pending' })
      .where(eq(s.employers.id, employerId));
    const j = await draft();
    await transitionJob(owner, j.id, 'submit');
    await expect(transitionJob(root, j.id, 'publish')).rejects.toMatchObject({ status: 409 });
  });
  it('enforces the free active listing allowance on the server', async () => {
    await publish();
    const j = await draft({ title: 'Second role' });
    await transitionJob(owner, j.id, 'submit');
    await expect(transitionJob(root, j.id, 'publish')).rejects.toMatchObject({ status: 402 });
  });
  it('isolates employer drafts from other users', async () => {
    await expect(saveJob(stranger, employerId, jobInput)).rejects.toMatchObject({ status: 403 });
    await expect(employerAccess(stranger, employerId)).rejects.toMatchObject({ status: 403 });
  });
  it('does not allow stale writes to overwrite a job', async () => {
    const j = await draft();
    await saveJob(owner, employerId, { ...jobInput, title: 'Updated role' }, j.id, j.version);
    await expect(saveJob(owner, employerId, jobInput, j.id, j.version)).rejects.toMatchObject({
      status: 409,
    });
  });
  it('removes active jobs from search immediately when edited', async () => {
    const j = await publish();
    await saveJob(owner, employerId, { ...jobInput, title: 'Changed role' }, j.id, j.version);
    expect((await searchJobs({})).total).toBe(0);
    const notifications = await ctx.db
      .select()
      .from(s.indexingNotifications)
      .where(eq(s.indexingNotifications.jobId, j.id));
    expect(notifications.some((v) => v.type === 'URL_DELETED')).toBe(true);
  });
  it('stores sanitized HTML and creates audit history', async () => {
    const j = await draft({
      descriptionHtml: description + '<script>alert(1)</script><img src=x onerror=alert(1)>',
    });
    expect(j.descriptionHtml).not.toContain('script');
    expect(j.descriptionHtml).not.toContain('onerror');
    expect((await ctx.db.select().from(s.auditLogs)).length).toBeGreaterThan(1);
  });
  it('allows only addressed verified users to accept invitations', async () => {
    const secret = 'fixture-invitation-token';
    await ctx.db.insert(s.invitations).values({
      employerId,
      email: candidate.email,
      role: 'recruiter',
      tokenHash: digest(secret),
      expiresAt: new Date(Date.now() + 10000),
    });
    await expect(acceptInvite(stranger, secret)).rejects.toMatchObject({ status: 403 });
    await acceptInvite(candidate, secret);
    expect((await employerAccess(candidate, employerId)).role).toBe('recruiter');
    await expect(acceptInvite(candidate, secret)).rejects.toMatchObject({ status: 404 });
  });
});
describe('search and lifecycle', () => {
  it('matches indexed text and suggestions without returning account data', async () => {
    await publish();
    const result = await searchJobs({ q: 'backend' });
    expect(result.total).toBe(1);
    expect(result.jobs[0]).not.toHaveProperty('email');
    expect(await suggestions('Back')).toEqual([{ title: 'Backend Engineer' }]);
  });
  it('uses trigram tolerance for misspelled titles', async () => {
    await publish();
    expect((await searchJobs({ q: 'Backend Enginere' })).total).toBe(1);
  });
  it('preserves structured country and workplace criteria', async () => {
    await publish();
    expect((await searchJobs({ country: 'GB' })).total).toBe(0);
    expect((await searchJobs({ country: 'NG', workplace: 'onsite' })).total).toBe(1);
  });
  it('requires comparable currency and period for salary sorting', async () => {
    await publish({ salaryMin: 50000, salaryMax: 70000, currency: 'USD', salaryPeriod: 'YEAR' });
    await expect(searchJobs({ sort: 'salary' })).rejects.toThrow();
    expect(
      (await searchJobs({ salaryMin: 60000, currency: 'USD', salaryPeriod: 'YEAR' })).total,
    ).toBe(0);
    expect(
      (
        await searchJobs({
          salaryMin: 40000,
          currency: 'USD',
          salaryPeriod: 'YEAR',
          sort: 'salary',
        })
      ).total,
    ).toBe(1);
  });
  it('filters remote applicant countries explicitly', async () => {
    await publish({ workplace: 'remote', remoteCountries: ['NG', 'GB'] });
    expect((await searchJobs({ eligibleCountry: 'NG' })).total).toBe(1);
    expect((await searchJobs({ eligibleCountry: 'US' })).total).toBe(0);
  });
  it('paginates on the database with stable counts', async () => {
    for (let i = 0; i < 25; i++) {
      const j = await draft({ title: 'Engineer ' + i });
      await ctx.db
        .update(s.jobs)
        .set({ status: 'active', originalPostedAt: new Date() })
        .where(eq(s.jobs.id, j.id));
    }
    expect((await searchJobs({ page: 1 })).jobs).toHaveLength(20);
    expect((await searchJobs({ page: 2 })).jobs).toHaveLength(5);
    expect((await searchJobs({ page: 2 })).total).toBe(25);
  });
  it('hides overdue jobs even before worker expiry, then archives them', async () => {
    const j = await publish();
    await ctx.db
      .update(s.jobs)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(s.jobs.id, j.id));
    expect((await searchJobs({})).total).toBe(0);
    expect(await expireJobs()).toBe(1);
    expect((await getPublicJob(j.id))?.status).toBe('expired');
  });
  it('does not expose draft or paused pages publicly', async () => {
    const d = await draft();
    expect(await getPublicJob(d.id)).toBeUndefined();
    const j = await publish();
    await transitionJob(owner, j.id, 'pause');
    expect(await getPublicJob(j.id)).toBeUndefined();
  });
  it('excludes demo records unless explicitly enabled outside production', async () => {
    const j = await publish();
    await ctx.db.update(s.jobs).set({ isDemo: true }).where(eq(s.jobs.id, j.id));
    expect((await searchJobs({})).total).toBe(0);
    expect(await getPublicJob(j.id)).toBeUndefined();
  });
});
describe('candidate workflows', () => {
  it('saves and removes jobs idempotently', async () => {
    const j = await publish();
    await toggleSaved(candidate, j.id, true);
    await toggleSaved(candidate, j.id, true);
    expect((await candidateDashboard(candidate)).saved).toHaveLength(1);
    await toggleSaved(candidate, j.id, false);
    expect((await candidateDashboard(candidate)).saved).toHaveLength(0);
  });
  it('persists a native application, visible event and notification atomically', async () => {
    const j = await publish();
    const app = await submitApplication(candidate, {
      jobId: j.id,
      coverLetter: 'My relevant experience',
    });
    expect(app.status).toBe('new');
    expect((await candidateDashboard(candidate)).applications).toHaveLength(1);
    expect((await ctx.db.select().from(s.applicationEvents)).length).toBe(1);
    expect((await ctx.db.select().from(s.deliveries)).length).toBe(1);
  });
  it('rejects duplicate applications', async () => {
    const j = await publish();
    await submitApplication(candidate, { jobId: j.id, coverLetter: '' });
    await expect(
      submitApplication(candidate, { jobId: j.id, coverLetter: '' }),
    ).rejects.toMatchObject({ status: 409 });
    expect(await ctx.db.select().from(s.applications)).toHaveLength(1);
  });
  it('rejects applications to closed or external vacancies', async () => {
    const j = await publish();
    await transitionJob(owner, j.id, 'close');
    await expect(
      submitApplication(candidate, { jobId: j.id, coverLetter: '' }),
    ).rejects.toMatchObject({ status: 409 });
    const external = await publish({
      applicationMethod: 'external',
      applyUrl: 'https://careers.example.com/apply',
    });
    await expect(
      submitApplication(candidate, { jobId: external.id, coverLetter: '' }),
    ).rejects.toMatchObject({ status: 400 });
  });
  it('blocks résumé harvesting across users and quarantine bypass', async () => {
    const j = await publish();
    const [resume] = await ctx.db
      .insert(s.resumes)
      .values({
        userId: stranger.id,
        objectKey: 'fixture-private.pdf',
        filename: 'fixture.pdf',
        mime: 'application/pdf',
        bytes: 100,
        sha256: 'fixture',
        status: 'clean',
      })
      .returning();
    await expect(
      submitApplication(candidate, { jobId: j.id, resumeId: resume.id, coverLetter: '' }),
    ).rejects.toMatchObject({ status: 404 });
    await ctx.db
      .update(s.resumes)
      .set({ userId: candidate.id, status: 'quarantined' })
      .where(eq(s.resumes.id, resume.id));
    await expect(
      submitApplication(candidate, { jobId: j.id, resumeId: resume.id, coverLetter: '' }),
    ).rejects.toMatchObject({ status: 409 });
  });
  it('prevents cross-employer applicant access and candidate status escalation', async () => {
    const j = await publish();
    const app = await submitApplication(candidate, { jobId: j.id, coverLetter: '' });
    await expect(employerApplications(stranger, employerId)).rejects.toMatchObject({ status: 403 });
    await expect(updateApplication(candidate, app.id, 'hired')).rejects.toMatchObject({
      status: 403,
    });
    await updateApplication(owner, app.id, 'shortlisted', 'Private recruiter note');
    expect((await employerApplications(owner, employerId))[0].application.status).toBe(
      'shortlisted',
    );
    const exported = await exportCandidateData(candidate);
    expect(JSON.stringify(exported)).not.toContain('Private recruiter note');
  });
  it('records external clicks without claiming submission', async () => {
    const j = await publish({
      applicationMethod: 'external',
      applyUrl: 'https://careers.example.com/apply',
    });
    const app = await trackExternal(candidate, j.id);
    expect(app.status).toBe('clicked_external');
    await trackExternal(candidate, j.id, 'applied_external');
    await trackExternal(candidate, j.id);
    expect((await candidateDashboard(candidate)).applications[0].application.status).toBe(
      'applied_external',
    );
  });
  it('requires alert consent and permits token-based unsubscribe', async () => {
    await expect(
      createAlert(candidate, {
        name: 'Backend roles',
        filters: {},
        frequency: 'daily',
        channel: 'email',
        consent: false,
      }),
    ).rejects.toThrow();
    const alert = await createAlert(candidate, {
      name: 'Backend roles',
      filters: {},
      frequency: 'daily',
      channel: 'email',
      consent: true,
    });
    expect(await unsubscribe(alert.unsubscribeToken)).toBe(true);
    expect((await ctx.db.select().from(s.alerts))[0].enabled).toBe(false);
  });
  it('generates one digest and one match notification per alert/job', async () => {
    const a = await createAlert(candidate, {
      name: 'Backend roles',
      filters: { q: 'backend' },
      frequency: 'daily',
      channel: 'email',
      consent: true,
    });
    await publish();
    await generateDigests();
    await ctx.db.update(s.alerts).set({ lastRunAt: null }).where(eq(s.alerts.id, a.id));
    await generateDigests();
    expect((await ctx.db.select().from(s.deliveries)).length).toBe(1);
    expect((await ctx.db.select().from(s.notifications)).length).toBe(1);
  });
  it('does not send pending digests after unsubscribe', async () => {
    const a = await createAlert(candidate, {
      name: 'Backend roles',
      filters: {},
      frequency: 'daily',
      channel: 'email',
      consent: true,
    });
    await publish();
    await generateDigests();
    const [delivery] = await ctx.db.select().from(s.deliveries);
    await unsubscribe(a.unsubscribeToken);
    await deliverNotification(delivery.id);
    expect((await ctx.db.select().from(s.deliveries))[0].status).toBe('cancelled');
  });
});
describe('ingestion snapshots', () => {
  it('upserts the same source record without duplication or a fabricated posting date', async () => {
    const src = await source();
    await syncSource(src.id, fetchRows(greenhouseRows([1])));
    await syncSource(src.id, fetchRows(greenhouseRows([1])));
    const records = await ctx.db.select().from(s.jobs);
    expect(records).toHaveLength(1);
    expect(records[0].originalPostedAt).toBeNull();
    expect(records[0].country).toBeNull();
    expect(records[0].status).toBe('pending');
    expect(await ctx.db.select().from(s.mappings)).toHaveLength(1);
  });
  it('does not close jobs after a temporary source outage', async () => {
    const src = await source();
    await syncSource(src.id, fetchRows(greenhouseRows([1])));
    await ctx.db.update(s.jobs).set({ status: 'active' });
    await expect(
      syncSource(
        src.id,
        vi.fn(async () => new Response('unavailable', { status: 503 })) as unknown as typeof fetch,
      ),
    ).rejects.toThrow();
    expect((await ctx.db.select().from(s.jobs))[0].status).toBe('active');
    expect((await ctx.db.select().from(s.mappings))[0].missingCount).toBe(0);
  });
  it('rejects an entire malformed snapshot without silently discarding a record', async () => {
    const src = await source();
    await syncSource(src.id, fetchRows(greenhouseRows([1])));
    await expect(
      syncSource(
        src.id,
        fetchRows({ jobs: [...greenhouseRows([1]).jobs, { id: 2, title: 'Bad' }] }),
      ),
    ).rejects.toThrow();
    expect(await ctx.db.select().from(s.jobs)).toHaveLength(1);
    expect((await ctx.db.select().from(s.mappings))[0].missingCount).toBe(0);
    expect(await ctx.db.select().from(s.ingestionErrors)).toHaveLength(1);
  });
  it('requires two spaced complete snapshots to confirm a closure', async () => {
    const src = await source();
    await syncSource(src.id, fetchRows(greenhouseRows([1])));
    await ctx.db.update(s.jobs).set({ status: 'active' });
    await syncSource(src.id, fetchRows(greenhouseRows([])));
    expect((await ctx.db.select().from(s.jobs))[0].status).toBe('active');
    await syncSource(src.id, fetchRows(greenhouseRows([])));
    expect((await ctx.db.select().from(s.mappings))[0].missingCount).toBe(1);
    await ctx.db.update(s.mappings).set({ lastMissingAt: new Date(Date.now() - 7200000) });
    await syncSource(src.id, fetchRows(greenhouseRows([])));
    expect((await ctx.db.select().from(s.jobs))[0].status).toBe('closed');
  });
  it('deduplicates exact authorized application destinations across source aliases', async () => {
    const src = await source();
    await syncSource(src.id, fetchRows(greenhouseRows([1])));
    const [other] = await ctx.db
      .insert(s.sources)
      .values({ ...src, id: crypto.randomUUID(), boardToken: 'second' })
      .returning();
    await syncSource(other.id, fetchRows(greenhouseRows([1])));
    expect(await ctx.db.select().from(s.jobs)).toHaveLength(1);
    expect(await ctx.db.select().from(s.mappings)).toHaveLength(2);
  });
  it('does not merge similar titles with different application URLs', async () => {
    const src = await source();
    await syncSource(src.id, fetchRows(greenhouseRows([1, 2])));
    expect(await ctx.db.select().from(s.jobs)).toHaveLength(2);
  });
  it('refuses disabled or insufficiently authorized sources', async () => {
    const src = await source();
    await ctx.db.update(s.sources).set({ enabled: false }).where(eq(s.sources.id, src.id));
    await expect(syncSource(src.id, fetchRows(greenhouseRows([])))).rejects.toThrow();
    await ctx.db
      .update(s.sources)
      .set({ enabled: true, permittedFields: ['title'] })
      .where(eq(s.sources.id, src.id));
    await expect(syncSource(src.id, fetchRows(greenhouseRows([])))).rejects.toThrow();
  });
});
describe('atomic payment settlement', () => {
  async function attempt() {
    return (
      await ctx.db
        .insert(s.checkouts)
        .values({
          employerId,
          userId: owner.id,
          planId: 'growth-usd',
          provider: 'stripe',
          reference: crypto.randomUUID(),
          providerReference: 'cs_fixture',
          amount: 4900,
          currency: 'USD',
          durationDays: 30,
          activeJobs: 10,
          featured: true,
          expiresAt: new Date(Date.now() + 3600000),
        })
        .returning()
    )[0];
  }
  function payment(a: Awaited<ReturnType<typeof attempt>>) {
    return {
      provider: 'stripe' as const,
      reference: a.reference,
      providerReference: 'cs_fixture',
      transactionId: 'pi_fixture',
      amount: 4900,
      currency: 'USD',
      paidAt: new Date(),
      attemptId: a.id,
    };
  }
  it('settles transaction, invoice and access together exactly once', async () => {
    const a = await attempt();
    const p = payment(a);
    expect((await settlePayment(p)).alreadySettled).toBe(false);
    expect((await settlePayment(p)).alreadySettled).toBe(true);
    expect(await ctx.db.select().from(s.transactions)).toHaveLength(1);
    expect(await ctx.db.select().from(s.invoices)).toHaveLength(1);
    expect(await ctx.db.select().from(s.subscriptions)).toHaveLength(1);
    await ctx.db.transaction(async (tx) =>
      expect(await jobAllowance(tx as never, employerId)).toBe(10),
    );
  });
  it('rejects forged amount, currency, attempt and provider bindings', async () => {
    const a = await attempt();
    const p = payment(a);
    for (const change of [
      { amount: 1 },
      { currency: 'NGN' },
      { attemptId: crypto.randomUUID() },
      { providerReference: 'cs_wrong' },
      { provider: 'paystack' as const },
    ])
      expect(() => validateSettlement(a, { ...p, ...change })).toThrow();
    expect(await ctx.db.select().from(s.subscriptions)).toHaveLength(0);
  });
  it('rolls back the entire settlement when invoice insertion fails', async () => {
    const a = await attempt();
    await ctx.client.exec(
      `CREATE FUNCTION fixture_fail_invoice() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture invoice failure'; END $$; CREATE TRIGGER fixture_invoice_failure BEFORE INSERT ON invoices FOR EACH ROW EXECUTE FUNCTION fixture_fail_invoice()`,
    );
    await expect(settlePayment(payment(a))).rejects.toThrow();
    expect(await ctx.db.select().from(s.transactions)).toHaveLength(0);
    expect(await ctx.db.select().from(s.subscriptions)).toHaveLength(0);
    expect((await ctx.db.select().from(s.checkouts))[0].status).toBe('pending');
    await ctx.client.exec(
      'DROP TRIGGER fixture_invoice_failure ON invoices; DROP FUNCTION fixture_fail_invoice()',
    );
  });
  it('serializes concurrent replay attempts without duplicate authoritative state', async () => {
    const a = await attempt();
    await Promise.all([settlePayment(payment(a)), settlePayment(payment(a))]);
    expect(await ctx.db.select().from(s.transactions)).toHaveLength(1);
    expect(await ctx.db.select().from(s.subscriptions)).toHaveLength(1);
  });
});

describe('additional regression repairs', () => {
  it('preserves an imported unknown original date after publication', async () => {
    const src = await source();
    await syncSource(src.id, fetchRows(greenhouseRows([99])));
    const [j] = await ctx.db.select().from(s.jobs);
    await saveJob(
      root,
      employerId,
      {
        ...jobInput,
        applicationMethod: 'external',
        applyUrl: j.applyUrl,
        originalPostedAt: null,
        title: j.title,
      },
      j.id,
      j.version,
    );
    await transitionJob(root, j.id, 'publish');
    expect((await ctx.db.select().from(s.jobs))[0].originalPostedAt).toBeNull();
  });
  it('never merges two requisitions from one source merely because application URLs match', async () => {
    const src = await source();
    const records = greenhouseRows([1, 2]);
    for (const r of records.jobs) {
      r.title = 'Identical Engineer';
      r.absolute_url = 'https://careers.example.com/shared';
    }
    await syncSource(src.id, fetchRows(records));
    expect(await ctx.db.select().from(s.jobs)).toHaveLength(2);
  });
  it('queues new notifications on employer disable and restore', async () => {
    const { disableEmployer } = await import('../../src/domain/admin');
    const j = await publish();
    await disableEmployer(root, employerId, true);
    expect((await searchJobs({})).total).toBe(0);
    await disableEmployer(root, employerId, false);
    expect((await searchJobs({})).total).toBe(1);
    const events = await ctx.db
      .select()
      .from(s.indexingNotifications)
      .where(eq(s.indexingNotifications.jobId, j.id));
    expect(events.filter((v) => v.type === 'URL_UPDATED')).toHaveLength(2);
  });
  it('prevents employers from advancing withdrawn applications', async () => {
    const j = await publish();
    const a = await submitApplication(candidate, { jobId: j.id, coverLetter: '' });
    await updateApplication(candidate, a.id, 'withdrawn');
    await expect(updateApplication(owner, a.id, 'hired')).rejects.toMatchObject({ status: 409 });
  });
  it('requires a current featured entitlement on the server', async () => {
    const { featureJob } = await import('../../src/domain/metrics');
    const j = await publish();
    await expect(featureJob(owner, employerId, j.id, 7)).rejects.toMatchObject({ status: 402 });
    expect(await ctx.db.select().from(s.placements)).toHaveLength(0);
  });
  it('recovers a verified provider settlement when initialization response persistence was interrupted', async () => {
    const [a] = await ctx.db
      .insert(s.checkouts)
      .values({
        employerId,
        userId: owner.id,
        planId: 'growth-usd',
        provider: 'stripe',
        reference: crypto.randomUUID(),
        providerReference: null,
        amount: 4900,
        currency: 'USD',
        durationDays: 30,
        activeJobs: 10,
        featured: true,
        expiresAt: new Date(Date.now() + 3600000),
      })
      .returning();
    await settlePayment({
      provider: 'stripe',
      reference: a.reference,
      providerReference: 'cs_recovered',
      transactionId: 'pi_recovered',
      amount: 4900,
      currency: 'USD',
      paidAt: new Date(),
      attemptId: a.id,
    });
    expect((await ctx.db.select().from(s.checkouts))[0].providerReference).toBe('cs_recovered');
  });
});

it('enforces employer-required clean résumé attachments', async () => {
  const j = await publish({ resumeRequired: true });
  await expect(
    submitApplication(candidate, { jobId: j.id, coverLetter: '' }),
  ).rejects.toMatchObject({ status: 400 });
});
it('pauses sole-source vacancies when the authorization source is disabled', async () => {
  const { setSourceEnabled } = await import('../../src/domain/ingestion');
  const src = await source();
  await syncSource(src.id, fetchRows(greenhouseRows([1])));
  await ctx.db.update(s.jobs).set({ status: 'active' });
  await setSourceEnabled(root.id, src.id, false);
  expect((await ctx.db.select().from(s.jobs))[0].status).toBe('paused');
  expect((await searchJobs({})).total).toBe(0);
});

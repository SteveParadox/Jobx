import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import * as s from '../../src/db/schema';
import { createEmployer, transitionJob, verifyEmployer } from '../../src/domain/jobs';
import { searchJobs } from '../../src/domain/search';
import { syncSource } from '../../src/domain/ingestion';
import { normalizedRecord } from '../../src/integrations/sources/normalize';
import {
  changeSourceEnabled, registerSource, reviewSource, updateSource,
} from '../../src/domain/source-management';
import { importApifyJobs, apifyBoardToken } from '../../src/integrations/apify';
import { digest, publicUrl, slugify } from '../../src/lib/security';
import { actor, description, testDatabase } from '../helpers';

const root = actor('apify-root', 'admin');
const owner = actor('apify-owner');
const actorId = 'fixture~actor';
const companyName = 'Approved Example Careers';
const website = publicUrl('https://careers.example.com');
const candidateSlug =
  slugify(companyName).slice(0, 60) + '-' + digest(companyName + '|' + website).slice(0, 8);
const boardToken = apifyBoardToken(actorId, candidateSlug, website);

function item() {
  return {
    id: 'external-requisition-1',
    url: 'https://careers.example.com/jobs/example-1',
    title: 'Remote Backend Engineer',
    description_html: description,
    organization: companyName,
    org_linkedin_website: website,
    ai_work_arrangement: 'Remote',
    countries_derived: ['Nigeria'],
    ai_remote_location_derived: ['United States', 'United Kingdom'],
    date_posted: '2020-01-02T00:00:00Z',
    date_valid_through: '2099-01-01T00:00:00Z',
    ai_salary_min_value: 60000,
    ai_salary_max_value: 80000,
    ai_salary_currency: 'USD',
    ai_salary_unit_text: 'YEAR',
    ai_employment_type: ['FULL_TIME'],
    vacancy_count: 2,
  };
}

describe('Apify approval, provenance, refresh and publication', () => {
  let ctx: Awaited<ReturnType<typeof testDatabase>>;
  let dir: string;
  let datasetFile: string;
  let employerId: string;

  async function feed(rows: Record<string, unknown>[]) {
    await writeFile(datasetFile, JSON.stringify(rows), 'utf8');
  }
  async function run() {
    return importApifyJobs({ actorId, datasetFile });
  }
  async function register(verified = true, autoPublish = true) {
    if (verified)
      await verifyEmployer(root, employerId, 'verified', 'Explicit fictional identity review for test fixtures only.');
    return registerSource(root, {
      employerId,
      provider: 'manual_apify',
      boardToken,
      permissionEvidence: 'Explicit fictional employer-approved Apify redistribution evidence.',
      attribution: 'Approved Apify actor fixture',
      permittedFields: [
        'title', 'description', 'location', 'application', 'date',
        'salary', 'skills', 'employment', 'experience',
      ],
      removalPolicy: 'Suspend this source and preserve audit history on withdrawal.',
      intervalMinutes: 60,
      autoPublish,
      applicationHostnames: ['careers.example.com'],
      usageConditions: 'Fictional source contract only; test records cannot be distributed.',
    });
  }
  async function authorize(autoPublish = true) {
    const source = await register(true, autoPublish);
    await reviewSource(root, source.id, 'approved', 'Fixture-only approval of redistribution rights and domains.');
    await changeSourceEnabled(root.id, source.id, true);
    return source;
  }

  beforeAll(async () => {
    ctx = await testDatabase();
    dir = await mkdtemp(join(tmpdir(), 'jobx-apify-'));
    datasetFile = join(dir, 'dataset.json');
  });
  afterAll(async () => {
    await ctx.client.close();
    await rm(dir, { recursive: true, force: true });
  });
  beforeEach(async () => {
    await ctx.client.exec('TRUNCATE users, employers, source_host_budgets RESTART IDENTITY CASCADE');
    await ctx.db.insert(s.user).values([root, owner]);
    employerId = (await createEmployer(owner, { name: companyName, website })).id;
    await feed([item()]);
  });

  it('rejects forged actor identity at the lower-level source synchronizer', async () => {
    const source = await authorize();
    const forgedRow = normalizedRecord({
      externalId: 'forged-actor-attempt',
      title: 'Remote Backend Engineer',
      sourceUrl: 'https://careers.example.com/jobs/example-1',
      applyUrl: 'https://careers.example.com/jobs/example-1',
      descriptionHtml: description,
      locationLabel: 'Remote',
      workplace: 'remote',
      remoteCountries: [],
      remoteEligibility: 'unknown',
    });
    await expect(
      syncSource(source.id, fetch, [forgedRow], {
        apifyActorId: 'fixture~wrong-actor',
        suppressMissing: true,
      }),
    ).rejects.toMatchObject({ code: 'SNAPSHOT_ORIGIN' });
    expect(await ctx.db.select().from(s.jobs)).toHaveLength(0);
  });

  it('does not publish or persist a job with no approved source', async () => {
    const result = await run();
    expect(result.imported).toBe(0);
    expect(result.awaitingApproval).toBe(1);
    expect(await ctx.db.select().from(s.jobs)).toHaveLength(0);
    const registered = await register();
    expect((await run()).imported).toBe(0);
    expect((await ctx.db.select().from(s.sources).where(eq(s.sources.id, registered.id)))[0].approvalStatus).toBe('pending');
  });

  it('requires employer verification before source approval; never verifies via Apify', async () => {
    const registered = await register(false);
    await expect(
      reviewSource(root, registered.id, 'approved', 'Fixture permission evidence is not employer verification.'),
    ).rejects.toMatchObject({ status: 409 });
    expect((await ctx.db.select().from(s.employers))[0].verificationStatus).toBe('pending');
    expect((await run()).awaitingApproval).toBe(1);
  });

  it('creates one owned, auditable and searchable job with unknown remote eligibility', async () => {
    const source = await authorize();
    const first = await run();
    expect(first.imported).toBe(1);
    expect(first.updated).toBe(0);
    const [job] = await ctx.db.select().from(s.jobs);
    expect(job.sourceOwnerId).toBe(source.id);
    expect(job.status).toBe('active');
    expect(job.remoteEligibility).toBe('unknown');
    expect(job.remoteCountries).toEqual([]);
    expect(job.vacancyCount).toBe(2);
    const [mapping] = await ctx.db.select().from(s.mappings);
    expect(mapping.sourceId).toBe(source.id);
    expect(mapping.externalId).toBe('external-requisition-1');
    expect(mapping.jobId).toBe(job.id);
    expect(mapping.normalizedPayload).toMatchObject({
      provenance: { provider: 'apify', actorId },
    });
    expect((await searchJobs({})).total).toBe(1);
    expect((await searchJobs({ eligibleCountry: 'NG' })).total).toBe(0);
    expect((await searchJobs({ eligibleCountry: 'US' })).total).toBe(0);
    expect((await ctx.db.select().from(s.employers))[0].name).toBe(companyName);
  });

  it('is idempotent and refreshes only source-owned fields with audit history', async () => {
    await authorize();
    await run();
    const [original] = await ctx.db.select().from(s.jobs);
    const second = await run();
    expect(second.imported).toBe(0);
    expect(second.updated).toBe(0);
    expect((await ctx.db.select().from(s.jobs))[0].version).toBe(original.version);
    const changed = {
      ...item(),
      description_html: description + '<p>New staff mentoring and code quality responsibilities.</p>',
      ai_salary_min_value: 70000,
      vacancy_count: 7,
      date_valid_through: '2099-03-01T00:00:00Z',
    };
    await feed([changed]);
    const result = await run();
    expect(result.updated).toBe(1);
    const [refreshed] = await ctx.db.select().from(s.jobs);
    expect(refreshed.id).toBe(original.id);
    expect(refreshed.salaryMin).toBe(70000);
    expect(refreshed.vacancyCount).toBe(7);
    expect(refreshed.expiresAt?.toISOString()).toBe('2099-03-01T00:00:00.000Z');
    expect(refreshed.descriptionText).toContain('New staff mentoring');
    expect(refreshed.version).toBe(original.version + 1);
    expect((await ctx.db.select().from(s.mappings))).toHaveLength(1);
    expect((await ctx.db.select().from(s.jobHistory)).some((h) => (h.change as { type?: string }).type === 'source_update')).toBe(true);
  });

  it('preserves missing optional values but honors explicit source clears', async () => {
    await authorize();
    await run();
    const absent: Record<string, unknown> = { ...item() };
    for (const key of [
      'ai_salary_min_value', 'ai_salary_max_value', 'ai_salary_currency',
      'ai_salary_unit_text', 'vacancy_count', 'date_valid_through',
    ]) delete absent[key];
    await feed([absent]);
    await run();
    let [job] = await ctx.db.select().from(s.jobs);
    expect(job.salaryMin).toBe(60000);
    expect(job.vacancyCount).toBe(2);
    expect(job.expiresAt?.getUTCFullYear()).toBe(2099);
    await feed([{ ...item(), ai_salary_min_value: null, ai_salary_max_value: null,
      ai_salary_currency: null, ai_salary_unit_text: null, vacancy_count: null }]);
    await run();
    [job] = await ctx.db.select().from(s.jobs);
    expect(job.salaryMin).toBeNull();
    expect(job.salaryMax).toBeNull();
    expect(job.vacancyCount).toBeNull();
  });

  it('quarantines a partial salary refresh that conflicts with a retained maximum', async () => {
    await authorize();
    await run();
    const [original] = await ctx.db.select().from(s.jobs);
    const changed: Record<string, unknown> = { ...item(), ai_salary_min_value: 90000 };
    delete changed.ai_salary_max_value;
    await feed([changed]);
    const result = await run();
    expect(result.updated).toBe(0);
    expect(result.imported).toBe(0);
    expect(result.existing).toBe(0);
    expect(result.quarantined).toBe(1);
    expect(result.skipped).toBe(1);
    const [unchanged] = await ctx.db.select().from(s.jobs);
    expect(unchanged.salaryMin).toBe(60000);
    expect(unchanged.salaryMax).toBe(80000);
    expect(unchanged.version).toBe(original.version);
    expect((await ctx.db.select().from(s.ingestionErrors)).some(
      (entry) => entry.reason.includes('PARTIAL_MERGE_INVALID'),
    )).toBe(true);
  });

  it('clears outdated applicant-country claims when a remote role becomes onsite', async () => {
    await authorize();
    await run();
    const [original] = await ctx.db.select().from(s.jobs);
    await ctx.db.update(s.jobs).set({
      remoteEligibility: 'restricted',
      remoteCountries: ['NG'],
    }).where(eq(s.jobs.id, original.id));
    await feed([{ ...item(), ai_work_arrangement: 'Onsite' }]);
    expect((await run()).updated).toBe(1);
    const [updated] = await ctx.db.select().from(s.jobs);
    expect(updated.workplace).toBe('onsite');
    expect(updated.remoteEligibility).toBe('unknown');
    expect(updated.remoteCountries).toEqual([]);
  });

  it('removes claims that are no longer covered by an approved source permission', async () => {
    await feed([{
      ...item(),
      ai_experience_level: '2-5',
      ai_education: 'Bachelor degree',
      ai_visa_sponsorship: true,
    }]);
    const source = await authorize();
    await run();
    let [job] = await ctx.db.select().from(s.jobs);
    expect(job.salaryMin).toBe(60000);
    expect(job.vacancyCount).toBe(2);
    expect(job.visaSponsorship).toBe(true);
    expect(job.seniority).toBe('mid');
    await updateSource(root, source.id, {
      ...source,
      enabled: false,
      endpointUrl: undefined,
      authorizationExpiresAt: null,
      permittedFields: ['title', 'description', 'location', 'application'],
    });
    await reviewSource(
      root,
      source.id,
      'approved',
      'Reapproved minimum title-description-location-application fields only.',
    );
    await changeSourceEnabled(root.id, source.id, true);
    await run();
    [job] = await ctx.db.select().from(s.jobs);
    expect(job.salaryMin).toBeNull();
    expect(job.salaryMax).toBeNull();
    expect(job.vacancyCount).toBeNull();
    expect(job.visaSponsorship).toBeNull();
    expect(job.seniority).toBeNull();
    expect(job.experienceMin).toBeNull();
    expect(job.education).toBeNull();
    expect(job.status).toBe('paused');
  });

  it('does not reactivate rejected or closed records after they reappear', async () => {
    await authorize();
    await run();
    const [job] = await ctx.db.select().from(s.jobs);
    await ctx.db.update(s.jobs).set({ status: 'rejected' }).where(eq(s.jobs.id, job.id));
    await run();
    expect((await ctx.db.select().from(s.jobs))[0].status).toBe('rejected');
    const closedAt = new Date('2024-05-01T00:00:00.000Z');
    await ctx.db.update(s.jobs).set({ status: 'closed', closedAt }).where(eq(s.jobs.id, job.id));
    await feed([{
      ...item(),
      description_html: description + '<p>Added updated responsibilities for archived job.</p>',
    }]);
    await run();
    const [closed] = await ctx.db.select().from(s.jobs);
    expect(closed.status).toBe('closed');
    expect(closed.closedAt?.toISOString()).toBe(closedAt.toISOString());
  });

  it('requires admin approval after employer resubmits a paused Apify job', async () => {
    await authorize();
    await run();
    const [job] = await ctx.db.select().from(s.jobs);
    await transitionJob(owner, job.id, 'pause');
    await transitionJob(owner, job.id, 'submit');
    expect((await ctx.db.select().from(s.jobs))[0].status).toBe('pending');
    const refresh = await run();
    expect(refresh.imported).toBe(0);
    expect((await ctx.db.select().from(s.jobs))[0].status).toBe('pending');
    await transitionJob(root, job.id, 'publish');
    expect((await ctx.db.select().from(s.jobs))[0].status).toBe('active');
    await run();
    expect((await ctx.db.select().from(s.jobs))[0].status).toBe('active');
  });

  it('honors explicit closure and never interprets a filtered snapshot as removal', async () => {
    await authorize();
    await run();
    await feed([]);
    await run();
    expect((await ctx.db.select().from(s.jobs))[0].status).toBe('active');
    await feed([{ ...item(), status: 'closed' }]);
    await run();
    expect((await ctx.db.select().from(s.jobs))[0].status).toBe('closed');
  });

  it('pauses jobs on source revocation and prevents future import', async () => {
    const source = await authorize();
    await run();
    await reviewSource(root, source.id, 'revoked', 'Recorded test authorization withdrawal from the approved source.');
    expect((await ctx.db.select().from(s.jobs))[0].status).toBe('paused');
    expect((await run()).awaitingApproval).toBe(1);
    expect((await searchJobs({})).total).toBe(0);
  });


  it('limits source revocation to the owner when two approved actors publish independently', async () => {
    const first = await authorize();
    await run();
    const alternateActor = 'fixture~independent';
    const second = await registerSource(root, {
      employerId,
      provider: 'manual_apify',
      boardToken: apifyBoardToken(alternateActor, candidateSlug, website),
      permissionEvidence: 'Recorded fictional separate source authority for the same verified employer.',
      attribution: 'Second independent fixture actor',
      permittedFields: ['title', 'description', 'location', 'application'],
      removalPolicy: 'Deactivate only the second independent source contribution.',
      intervalMinutes: 60,
      autoPublish: true,
      applicationHostnames: ['careers.example.com'],
      usageConditions: 'Fictional contract for independent actor identity fixture.',
    });
    await reviewSource(root, second.id, 'approved', 'Second independent fixture source authorization evidence.');
    await changeSourceEnabled(root.id, second.id, true);
    expect((await importApifyJobs({ actorId: alternateActor, datasetFile })).imported).toBe(1);
    const rows = await ctx.db.select().from(s.jobs);
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((job) => job.sourceOwnerId))).toEqual(
      new Set([first.id, second.id]),
    );
    await reviewSource(root, second.id, 'revoked', 'Revoking only the second source fixture approval evidence.');
    expect((await ctx.db.select().from(s.jobs).where(eq(s.jobs.sourceOwnerId, first.id)))[0].status).toBe('active');
    expect((await ctx.db.select().from(s.jobs).where(eq(s.jobs.sourceOwnerId, second.id)))[0].status).toBe('paused');
    expect((await searchJobs({})).total).toBe(1);
  });

  it('respects source suspension without deleting independently maintained listings', async () => {
    const source = await authorize();
    await run();
    await changeSourceEnabled(root.id, source.id, false);
    expect((await run()).imported).toBe(0);
    expect((await ctx.db.select().from(s.mappings))).toHaveLength(1);
    expect((await ctx.db.select().from(s.jobs))[0].status).toBe('paused');
    expect((await searchJobs({})).total).toBe(0);
  });

  it('refreshes explicitly changed location metadata without inferring applicant eligibility', async () => {
    await authorize();
    await run();
    await feed([{
      ...item(),
      locations_derived: ['Port Harcourt, Nigeria'],
      cities_derived: ['Port Harcourt'],
      countries_derived: ['Nigeria'],
    }]);
    expect((await run()).updated).toBe(1);
    const [job] = await ctx.db.select().from(s.jobs);
    expect(job.locationLabel).toBe('Port Harcourt, Nigeria');
    expect(job.city).toBe('Port Harcourt');
    expect(job.remoteEligibility).toBe('unknown');
    expect(job.remoteCountries).toEqual([]);
  });

  it('does not close jobs after malformed source data or a failed dataset read', async () => {
    await authorize();
    await run();
    await writeFile(datasetFile, '{malformed json', 'utf8');
    await expect(run()).rejects.toThrow();
    expect((await ctx.db.select().from(s.jobs))[0].status).toBe('active');
  });

  it('quarantines ambiguous historical unowned jobs without inventing ownership', async () => {
    const source = await authorize();
    const [legacy] = await ctx.db
      .insert(s.jobs)
      .values({
        employerId,
        slug: 'legacy-remote-backend-engineer',
        title: 'Remote Backend Engineer',
        descriptionHtml: description,
        descriptionText: description.replace(/<[^>]+>/g, ''),
        locationLabel: 'Location not specified',
        workplace: 'remote',
        remoteEligibility: 'unknown',
        remoteCountries: [],
        applyUrl: 'https://careers.example.com/jobs/example-1',
        applicationMethod: 'external',
        status: 'pending',
        fingerprint: 'legacy-without-apify-provenance',
      })
      .returning();
    await feed([{ ...item(), title: 'Senior Backend Platform Engineer' }]);
    const imported = await run();
    expect(imported.imported).toBe(0);
    expect((await ctx.db.select().from(s.jobs))).toHaveLength(1);
    expect((await ctx.db.select().from(s.mappings))).toHaveLength(0);
    const [remaining] = await ctx.db.select().from(s.jobs);
    expect(remaining.id).toBe(legacy.id);
    expect(remaining.sourceOwnerId).toBeNull();
    expect(remaining.status).toBe('pending');
    expect((await ctx.db.select().from(s.ingestionErrors)).some(
      (row) => row.stage === 'provenance' &&
        row.reason.includes('AMBIGUOUS_LEGACY_OWNER'),
    )).toBe(true);
    expect((await ctx.db.select().from(s.sources).where(eq(s.sources.id, source.id)))[0].approvalStatus).toBe('approved');
  });

  it('does not let an actor rename or take over another employer', async () => {
    await authorize();
    await run();
    await feed([{ ...item(), organization: 'Impersonating Organization' }]);
    expect((await run()).awaitingApproval).toBe(1);
    expect((await ctx.db.select().from(s.jobs))).toHaveLength(1);
    expect((await ctx.db.select().from(s.employers))[0].name).toBe(companyName);
  });

  it('rejects missing credentials and malformed records without creating jobs', async () => {
    await expect(importApifyJobs({ token: '' })).rejects.toThrow('APIFY_TOKEN');
    await authorize();
    await feed([{ ...item(), title: '', description_html: '' }]);
    expect((await run()).imported).toBe(0);
    expect((await ctx.db.select().from(s.jobs))).toHaveLength(0);
  });

  it('keeps auto-publish disabled sources pending even when ingestion succeeds', async () => {
    await authorize(false);
    expect((await run()).imported).toBe(1);
    expect((await ctx.db.select().from(s.jobs))[0].status).toBe('pending');
    expect((await searchJobs({})).total).toBe(0);
  });
});

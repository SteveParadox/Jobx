import { eq } from 'drizzle-orm';
import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as s from '../../src/db/schema';
import { createAlert } from '../../src/domain/candidates';
import { syncSource } from '../../src/domain/ingestion';
import {
  controlIngestionTask,
  enqueueSource,
  processIngestionTask,
  recoverIngestionTasks,
  scheduleSources,
} from '../../src/domain/ingestion-tasks';
import { createEmployer, saveJob, transitionJob, verifyEmployer } from '../../src/domain/jobs';
import { generateDigests } from '../../src/domain/notifications';
import { getPublicJob, searchJobs } from '../../src/domain/search';
import {
  changeSourceEnabled,
  expireSourceAuthorizations,
  registerSource,
  reviewSource,
  updateSource,
} from '../../src/domain/source-management';
import type { Transport } from '../../src/integrations/sources/http';
import { dispatchCommands, tickIngestion } from '../../src/worker/ingestion';
import { actor, jobInput, testDatabase } from '../helpers';
let ctx: Awaited<ReturnType<typeof testDatabase>>;
const root = actor('root', 'admin');
const owner = actor('owner');
const candidate = actor('candidate');
let employerId: string;
let payload: Record<string, unknown>;
let sourceInput: Record<string, unknown>;
let transport: Transport;
const options = () => ({ transport, pace: async () => {} });
beforeAll(async () => {
  ctx = await testDatabase();
});
afterAll(async () => {
  await ctx.client.close();
});
beforeEach(async () => {
  await ctx.client.exec('TRUNCATE users, employers, source_host_budgets RESTART IDENTITY CASCADE');
  for (const user of [root, owner, candidate]) await ctx.db.insert(s.user).values(user);
  employerId = (
    await createEmployer(owner, {
      name: 'Recorded fixture employer',
      website: 'https://careers.example.com',
    })
  ).id;
  await verifyEmployer(
    root,
    employerId,
    'verified',
    'Explicit fictional fixture verification evidence only.',
  );
  payload = JSON.parse(await readFile('tests/fixtures/ingestion/jobs.json', 'utf8'));
  sourceInput = {
    employerId,
    provider: 'authorized_json',
    boardToken: 'fixture',
    endpointUrl: 'https://careers.example.com/jobs.json',
    applicationHostnames: ['careers.example.com'],
    permissionEvidence: 'Recorded fixture permission, never a live source approval.',
    usageConditions: 'Fixture tests only; no real redistribution permission claimed.',
    attribution: 'Recorded fixture employer feed',
    removalPolicy: 'Close confirmed absent fixture openings after spaced snapshots.',
    intervalMinutes: 60,
    permittedFields: [
      'title',
      'description',
      'location',
      'application',
      'date',
      'salary',
      'skills',
      'employment',
      'experience',
    ],
    autoPublish: true,
    config: { recordsPath: 'jobs', nextPath: 'next', emptyMeansComplete: true },
  };
  transport = async (url) => ({
    url,
    status: 200,
    headers: new Headers({
      'content-type': url.endsWith('/robots.txt') ? 'text/plain' : 'application/json',
    }),
    body: url.endsWith('/robots.txt') ? 'User-agent: *\nAllow: /' : JSON.stringify(payload),
  });
});
async function registered() {
  return registerSource(root, sourceInput);
}
async function approved() {
  const source = await registered();
  await reviewSource(
    root,
    source.id,
    'approved',
    'Explicit source contract and employer fixture approval.',
  );
  return source;
}
async function enabled() {
  const source = await approved();
  const task = await enqueueSource(root, source.id, 'test');
  await processIngestionTask(task.taskId, options());
  await changeSourceEnabled(root.id, source.id, true);
  return source;
}
async function runSource(id: string) {
  const task = await enqueueSource(root, id);
  return processIngestionTask(task.taskId, options());
}
function jobs() {
  return payload.jobs as Record<string, unknown>[];
}
describe('approval and canonical ingestion lifecycle', () => {
  it('withdraws expired redistribution authorization from search and indexing surfaces', async () => {
    const source = await enabled();
    await runSource(source.id);
    await ctx.db.update(s.sources).set({ authorizationExpiresAt: new Date(Date.now() - 1000) });
    expect((await searchJobs({})).total).toBe(0);
    expect(await expireSourceAuthorizations()).toBe(1);
    expect((await ctx.db.select().from(s.sources))[0].approvalStatus).toBe('revoked');
    expect((await ctx.db.select().from(s.jobs))[0].status).toBe('paused');
    expect(
      (await ctx.db.select().from(s.indexingNotifications)).some(
        (row) => row.type === 'URL_DELETED',
      ),
    ).toBe(true);
  });
  it('refuses unapproved collection and requires a successful non-publishing source test before scheduling', async () => {
    const source = await registered();
    await expect(enqueueSource(root, source.id)).rejects.toMatchObject({ code: 'NOT_APPROVED' });
    await expect(registerSource(candidate, sourceInput)).rejects.toMatchObject({ status: 403 });
    await reviewSource(
      root,
      source.id,
      'approved',
      'Explicit source permission review for this fixture.',
    );
    await expect(changeSourceEnabled(root.id, source.id, true)).rejects.toMatchObject({
      status: 409,
    });
    const test = await enqueueSource(root, source.id, 'test');
    await processIngestionTask(test.taskId, options());
    expect(await ctx.db.select().from(s.jobs)).toHaveLength(0);
    expect((await ctx.db.select().from(s.sources))[0].validatedRevision).toBe(1);
    await changeSourceEnabled(root.id, source.id, true);
    expect(await scheduleSources()).toBe(1);
    expect(await scheduleSources()).toBe(0);
  });
  it('runs schedule → durable outbox → worker → canonical database → search → alerts → update → confirmed closure', async () => {
    const source = await enabled();
    await createAlert(candidate, {
      name: 'Fixture backend alert',
      filters: { q: 'backend' },
      frequency: 'daily',
      channel: 'in_app',
      consent: true,
    });
    const queued = new Map<string, { name: string; data: unknown }>();
    const queue = {
      add: vi.fn(async (name: string, data: unknown, opts: { jobId: string }) => {
        queued.set(opts.jobId, { name, data });
      }),
    };
    await tickIngestion(queue);
    const tasks = await ctx.db
      .select()
      .from(s.ingestionTasks)
      .where(eq(s.ingestionTasks.kind, 'sync'));
    expect(tasks).toHaveLength(1);
    expect(queued.size).toBeGreaterThan(0);
    await processIngestionTask(tasks[0].id, options());
    const result = await searchJobs({ q: 'backend', country: 'NG' });
    expect(result.total).toBe(1);
    const first = result.jobs[0];
    expect(first.descriptionHtml).not.toContain('<script');
    expect(first.applyUrl).toBe('https://careers.example.com/jobs/one/apply');
    expect(first.salaryMin).toBeNull();
    expect((await getPublicJob(first.id))?.title).toBe('Fixture Backend Engineer');
    await generateDigests();
    expect(await ctx.db.select().from(s.notifications)).toHaveLength(1);
    await runSource(source.id);
    expect(await ctx.db.select().from(s.jobs)).toHaveLength(1);
    expect(await ctx.db.select().from(s.mappings)).toHaveLength(1);
    const original = first.originalPostedAt;
    jobs()[0].descriptionHtml =
      String(jobs()[0].descriptionHtml) +
      '<p>Updated responsibilities in this controlled fixture.</p>';
    jobs()[0].originalPostedAt = '2025-02-01T08:00:00.000Z';
    await runSource(source.id);
    expect((await getPublicJob(first.id))?.originalPostedAt).toEqual(original);
    expect((await getPublicJob(first.id))?.descriptionHtml).toContain('Updated responsibilities');
    payload = { jobs: [], next: null };
    await runSource(source.id);
    expect((await searchJobs({})).total).toBe(1);
    await ctx.db.update(s.mappings).set({ lastMissingAt: new Date(Date.now() - 7200000) });
    await runSource(source.id);
    expect((await searchJobs({})).total).toBe(0);
    expect(await getPublicJob(first.id)).toBeUndefined();
    expect((await ctx.db.select().from(s.jobs))[0].status).toBe('closed');
    const indexing = await ctx.db.select().from(s.indexingNotifications);
    expect(indexing.some((row) => row.type === 'URL_UPDATED')).toBe(true);
    expect(indexing.some((row) => row.type === 'URL_DELETED')).toBe(true);
    expect(await ctx.db.select().from(s.jobHistory)).toHaveLength(3);
  });
  it('retains active jobs after outage, quarantine or a partial source snapshot', async () => {
    const source = await enabled();
    await runSource(source.id);
    transport = async (url) => ({ url, status: 503, headers: new Headers(), body: 'Unavailable' });
    const failed = await runSource(source.id);
    expect(failed).toMatchObject({ status: 'retrying' });
    expect((await searchJobs({})).total).toBe(1);
    expect((await ctx.db.select().from(s.mappings))[0].missingCount).toBe(0);
    const [retry] = await ctx.db
      .select()
      .from(s.ingestionTasks)
      .where(eq(s.ingestionTasks.status, 'retrying'));
    await controlIngestionTask(root, retry.id, 'cancel');
    transport = async (url) => ({
      url,
      status: 200,
      headers: new Headers({
        'content-type': url.endsWith('/robots.txt') ? 'text/plain' : 'application/json',
      }),
      body: url.endsWith('/robots.txt')
        ? 'User-agent: *\nAllow: /'
        : JSON.stringify({ jobs: [{ externalId: 'bad', title: 'Bad' }], next: null }),
    });
    const partial = await runSource(source.id);
    expect(partial).toMatchObject({ complete: false, quarantined: 1 });
    expect((await searchJobs({})).total).toBe(1);
    expect((await ctx.db.select().from(s.mappings))[0].missingCount).toBe(0);
  });
  it('promotes unchanged pending jobs once approved auto-publication becomes enabled', async () => {
    const source = await enabled();
    await ctx.db.update(s.sources).set({ autoPublish: false })
      .where(eq(s.sources.id, source.id));
    await runSource(source.id);
    expect((await ctx.db.select().from(s.jobs))[0].status).toBe('pending');
    await ctx.db.update(s.sources).set({ autoPublish: true })
      .where(eq(s.sources.id, source.id));
    await runSource(source.id);
    expect((await ctx.db.select().from(s.jobs))[0].status).toBe('active');
    expect((await searchJobs({})).total).toBe(1);
    expect(await ctx.db.select().from(s.jobs)).toHaveLength(1);
  });
  it('keeps unknown location and remote eligibility pending instead of fabricating publishable values', async () => {
    jobs()[0].country = undefined;
    jobs()[0].locationLabel = 'Location not specified';
    jobs()[0].workplace = 'unknown';
    const source = await enabled();
    await runSource(source.id);
    const [job] = await ctx.db.select().from(s.jobs);
    expect(job).toMatchObject({ status: 'pending', country: null, salaryMin: null });
    expect((await searchJobs({})).total).toBe(0);
  });
  it('expires disclosed deadlines and restores a confirmed closed job only under current source policy', async () => {
    const source = await enabled();
    await runSource(source.id);
    const id = (await ctx.db.select().from(s.jobs))[0].id;
    jobs()[0].expiresAt = '2025-12-31T00:00:00.000Z';
    await runSource(source.id);
    expect((await searchJobs({})).total).toBe(0);
    expect((await ctx.db.select().from(s.jobs))[0].status).toBe('expired');
    jobs()[0].expiresAt = '2030-12-31T00:00:00.000Z';
    await runSource(source.id);
    expect((await searchJobs({})).jobs[0].id).toBe(id);
  });
  it('protects employer edits from lower-trust source updates and source-absence closure', async () => {
    const source = await enabled();
    await runSource(source.id);
    const [job] = await ctx.db.select().from(s.jobs);
    const edited = await saveJob(
      owner,
      employerId,
      {
        ...jobInput,
        title: 'Employer controlled role',
        applicationMethod: 'external',
        applyUrl: job.applyUrl,
      },
      job.id,
      job.version,
    );
    expect(edited.sourceOwnerId).toBeNull();
    await transitionJob(root, edited.id, 'publish');
    jobs()[0].title = 'Lower trust changed title';
    await runSource(source.id);
    expect((await getPublicJob(job.id))?.title).toBe('Employer controlled role');
    payload = { jobs: [], next: null };
    await runSource(source.id);
    await ctx.db.update(s.mappings).set({ lastMissingAt: new Date(Date.now() - 7200000) });
    await runSource(source.id);
    expect((await searchJobs({})).total).toBe(1);
  });
  it('deduplicates identical cross-source aliases and prevents within-source request-ID merging', async () => {
    const source = await enabled();
    await runSource(source.id);
    sourceInput = { ...sourceInput, boardToken: 'second' };
    const second = await enabled();
    await runSource(second.id);
    expect(await ctx.db.select().from(s.jobs)).toHaveLength(1);
    expect(await ctx.db.select().from(s.mappings)).toHaveLength(2);
    jobs().push({ ...jobs()[0], externalId: 'separate-requisition' });
    await runSource(source.id);
    expect(await ctx.db.select().from(s.jobs)).toHaveLength(2);
  });
  it('revokes old approval when configuration changes and immediately excludes its jobs from search', async () => {
    const source = await enabled();
    await runSource(source.id);
    await updateSource(root, source.id, { ...sourceInput, intervalMinutes: 120 });
    expect((await searchJobs({})).total).toBe(0);
    expect((await ctx.db.select().from(s.sources))[0]).toMatchObject({
      approvalStatus: 'pending',
      enabled: false,
      revision: 2,
      validatedRevision: null,
    });
  });
});
describe('durable worker recovery and transactional safety', () => {
  it('creates a fresh queue identity when retrying a task cancelled before its first claim', async () => {
    const source = await enabled();
    const task = await enqueueSource(root, source.id);
    const before = (await ctx.db.select().from(s.outbox)).length;
    await controlIngestionTask(root, task.taskId, 'cancel');
    await controlIngestionTask(root, task.taskId, 'retry');
    expect((await ctx.db.select().from(s.outbox)).length).toBe(before + 1);
    await processIngestionTask(task.taskId, options());
    expect((await searchJobs({})).total).toBe(1);
  });
  it('keeps permanently invalid sources in dead-letter review instead of restarting their retry budget', async () => {
    const source = await enabled();
    transport = async (url) => ({
      url,
      status: 200,
      body: 'not json',
      headers: new Headers({
        'content-type': url.endsWith('/robots.txt') ? 'text/plain' : 'application/json',
      }),
    });
    expect(await runSource(source.id)).toMatchObject({ status: 'failed' });
    expect((await ctx.db.select().from(s.sources))[0].health).toBe('dead_letter');
    expect(await scheduleSources()).toBe(0);
  });
  it('revalidates permitted application redirects, pauses unsafe destinations and closes verified 410 responses', async () => {
    sourceInput = {
      ...sourceInput,
      config: {
        recordsPath: 'jobs',
        emptyMeansComplete: true,
        checkApplicationLinks: true,
        applicationFetchPermitted: true,
      },
    };
    let status = 'redirect';
    transport = async (url) => {
      if (url.endsWith('/robots.txt'))
        return {
          url,
          status: 200,
          headers: new Headers({ 'content-type': 'text/plain' }),
          body: 'User-agent: *\nAllow: /',
        };
      if (url.includes('jobs.json'))
        return {
          url,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          body: JSON.stringify(payload),
        };
      if (status === 'unsafe')
        return {
          url,
          status: 302,
          headers: new Headers({ location: 'https://unapproved.example.com/advertisement' }),
          body: '',
        };
      if (status === 'gone') return { url, status: 410, headers: new Headers(), body: '' };
      if (url.endsWith('/apply'))
        return {
          url,
          status: 302,
          headers: new Headers({ location: '/current-application' }),
          body: '',
        };
      return {
        url,
        status: 200,
        headers: new Headers({ 'content-type': 'text/html' }),
        body: '<p>Controlled application fixture</p>',
      };
    };
    const source = await enabled();
    await runSource(source.id);
    expect((await searchJobs({})).jobs[0].applyUrl).toBe(
      'https://careers.example.com/current-application',
    );
    status = 'unsafe';
    await runSource(source.id);
    expect((await searchJobs({})).total).toBe(0);
    expect((await ctx.db.select().from(s.jobs))[0].status).toBe('paused');
    status = 'gone';
    await runSource(source.id);
    expect((await ctx.db.select().from(s.jobs))[0].status).toBe('closed');
  });
  it('serializes duplicate task claims and concurrent direct imports without duplicate jobs', async () => {
    const source = await enabled();
    const task = await enqueueSource(root, source.id);
    await Promise.all([
      processIngestionTask(task.taskId, options()),
      processIngestionTask(task.taskId, options()),
    ]);
    expect(await ctx.db.select().from(s.jobs)).toHaveLength(1);
    const outcomes = await Promise.allSettled([
      syncSource(source.id, fetch, undefined, options()),
      syncSource(source.id, fetch, undefined, options()),
    ]);
    expect(outcomes.some((outcome) => outcome.status === 'rejected')).toBe(true);
    expect(await ctx.db.select().from(s.jobs)).toHaveLength(1);
  });
  it('replays expired worker leases idempotently after a committed snapshot', async () => {
    const source = await enabled();
    await runSource(source.id);
    const [task] = await ctx.db
      .select()
      .from(s.ingestionTasks)
      .where(eq(s.ingestionTasks.kind, 'sync'));
    await ctx.db
      .update(s.ingestionTasks)
      .set({
        status: 'running',
        leaseToken: crypto.randomUUID(),
        leaseUntil: new Date(Date.now() - 1000),
      })
      .where(eq(s.ingestionTasks.id, task.id));
    await recoverIngestionTasks();
    expect(
      (await ctx.db.select().from(s.ingestionTasks).where(eq(s.ingestionTasks.id, task.id)))[0]
        .status,
    ).toBe('retrying');
    await processIngestionTask(task.id, options());
    expect(await ctx.db.select().from(s.jobs)).toHaveLength(1);
    expect(await ctx.db.select().from(s.mappings)).toHaveLength(1);
  });
  it.each([false, true])(
    'finishes abandoned sync runs when recovery is terminal (cancelled=%s)',
    async (cancelRequested) => {
      const source = await enabled();
      const { taskId } = await enqueueSource(root, source.id);
      const expired = new Date(Date.now() - 1000);
      await ctx.db
        .update(s.ingestionTasks)
        .set({
          status: 'running',
          attempts: 5,
          maxAttempts: 5,
          cancelRequested,
          leaseToken: crypto.randomUUID(),
          leaseUntil: expired,
        })
        .where(eq(s.ingestionTasks.id, taskId));
      await ctx.db
        .update(s.sources)
        .set({
          syncLeaseToken: crypto.randomUUID(),
          syncLeaseUntil: expired,
        })
        .where(eq(s.sources.id, source.id));
      const [run] = await ctx.db
        .insert(s.syncRuns)
        .values({
          sourceId: source.id,
          taskId,
          revision: source.revision,
          status: 'persisting',
        })
        .returning();
      const commandsBefore = (await ctx.db.select().from(s.outbox)).length;
      await recoverIngestionTasks();
      const [stored] = await ctx.db
        .select()
        .from(s.ingestionTasks)
        .where(eq(s.ingestionTasks.id, taskId));
      expect(stored).toMatchObject({
        status: cancelRequested ? 'cancelled' : 'failed',
        leaseToken: null,
        leaseUntil: null,
      });
      expect(stored.finishedAt).not.toBeNull();
      const [closedRun] = await ctx.db.select().from(s.syncRuns).where(eq(s.syncRuns.id, run.id));
      expect(closedRun.status).toBe(cancelRequested ? 'cancelled' : 'failed');
      expect(closedRun.finishedAt).not.toBeNull();
      const [storedSource] = await ctx.db
        .select()
        .from(s.sources)
        .where(eq(s.sources.id, source.id));
      expect(storedSource.syncLeaseToken).toBeNull();
      expect(storedSource.syncLeaseUntil).toBeNull();
      if (!cancelRequested) expect(storedSource.health).toBe('dead_letter');
      expect(await ctx.db.select().from(s.outbox)).toHaveLength(commandsBefore);
      await recoverIngestionTasks();
      expect(await ctx.db.select().from(s.outbox)).toHaveLength(commandsBefore);
    },
  );
  it.each([
    { maxAttempts: 1, replaceSourceLease: false },
    { maxAttempts: 5, replaceSourceLease: false },
    { maxAttempts: 1, replaceSourceLease: true },
    { maxAttempts: 5, replaceSourceLease: true },
  ])(
    'ignores a superseded worker failure ($maxAttempts attempts, replaceSourceLease=$replaceSourceLease)',
    async ({ maxAttempts, replaceSourceLease }) => {
      const source = await enabled();
      const { taskId } = await enqueueSource(root, source.id);
      await ctx.db
        .update(s.ingestionTasks)
        .set({ maxAttempts })
        .where(eq(s.ingestionTasks.id, taskId));
      const successorLease = crypto.randomUUID();
      const nextSyncAt = new Date(Date.now() + 7200000);
      transport = async () => {
        // Simulate a paused process resuming after another worker took ownership.
        await ctx.db
          .update(s.ingestionTasks)
          .set({ leaseToken: successorLease })
          .where(eq(s.ingestionTasks.id, taskId));
        await ctx.db
          .update(s.sources)
          .set({
            ...(replaceSourceLease ? { syncLeaseToken: successorLease } : {}),
            health: 'healthy',
            nextSyncAt,
          })
          .where(eq(s.sources.id, source.id));
        throw new Error('Delayed failure from the superseded transport');
      };
      const outcome = await processIngestionTask(taskId, options());
      const [stored] = await ctx.db
        .select()
        .from(s.ingestionTasks)
        .where(eq(s.ingestionTasks.id, taskId));
      expect(stored).toMatchObject({ status: 'running', leaseToken: successorLease });
      const [storedSource] = await ctx.db
        .select()
        .from(s.sources)
        .where(eq(s.sources.id, source.id));
      expect(storedSource.health).toBe('healthy');
      expect(storedSource.consecutiveFailures).toBe(0);
      if (replaceSourceLease) expect(storedSource.syncLeaseToken).toBe(successorLease);
      expect(storedSource.nextSyncAt).toEqual(nextSyncAt);
      expect(outcome).toEqual({ skipped: true });
    },
  );
  it('rejects a superseded task lease before committing its snapshot', async () => {
    const source = await enabled();
    const { taskId } = await enqueueSource(root, source.id);
    const successorLease = crypto.randomUUID();
    await ctx.db
      .update(s.ingestionTasks)
      .set({
        status: 'running',
        leaseToken: successorLease,
        leaseUntil: new Date(Date.now() + 600000),
      })
      .where(eq(s.ingestionTasks.id, taskId));
    await expect(
      syncSource(source.id, fetch, undefined, {
        ...options(),
        taskId,
        taskLeaseToken: crypto.randomUUID(),
      }),
    ).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(await ctx.db.select().from(s.jobs)).toHaveLength(0);
    expect(await ctx.db.select().from(s.mappings)).toHaveLength(0);
    const [stored] = await ctx.db
      .select()
      .from(s.ingestionTasks)
      .where(eq(s.ingestionTasks.id, taskId));
    expect(stored).toMatchObject({ status: 'running', leaseToken: successorLease });
  });
  it('persists rate-limit retries and supports authorized cancellation/retry', async () => {
    const source = await enabled();
    transport = async (url) => ({
      url,
      status: 429,
      body: '',
      headers: new Headers({ 'retry-after': '120' }),
    });
    const task = await enqueueSource(root, source.id);
    await processIngestionTask(task.taskId, options());
    const [stored] = await ctx.db
      .select()
      .from(s.ingestionTasks)
      .where(eq(s.ingestionTasks.id, task.taskId));
    expect(stored.status).toBe('retrying');
    expect(stored.availableAt.getTime()).toBeGreaterThan(Date.now() + 110000);
    await expect(controlIngestionTask(candidate, task.taskId, 'cancel')).rejects.toMatchObject({
      status: 403,
    });
    await controlIngestionTask(root, task.taskId, 'cancel');
    await controlIngestionTask(root, task.taskId, 'retry');
    expect(
      (await ctx.db.select().from(s.ingestionTasks).where(eq(s.ingestionTasks.id, task.taskId)))[0]
        .status,
    ).toBe('queued');
  });
  it('cancels an in-flight fetch before any public data is persisted', async () => {
    const source = await enabled();
    const task = await enqueueSource(root, source.id);
    let checks = 0;
    await processIngestionTask(task.taskId, {
      ...options(),
      checkCancelled: async () => {
        if (++checks === 2)
          await ctx.db
            .update(s.ingestionTasks)
            .set({ cancelRequested: true })
            .where(eq(s.ingestionTasks.id, task.taskId));
      },
    });
    expect(await ctx.db.select().from(s.jobs)).toHaveLength(0);
    expect(
      (await ctx.db.select().from(s.ingestionTasks).where(eq(s.ingestionTasks.id, task.taskId)))[0]
        .status,
    ).toBe('cancelled');
  });
  it('rolls back jobs, mappings and search publication when persistence/index maintenance fails', async () => {
    const source = await enabled();
    await ctx.client.exec(
      "CREATE OR REPLACE FUNCTION array_to_string_immutable(text[]) RETURNS text LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$ BEGIN RAISE EXCEPTION 'Injected generated search-vector failure'; END $$;",
    );
    try {
      expect(await runSource(source.id)).toMatchObject({ status: 'retrying', code: 'PERSISTENCE' });
      expect(await ctx.db.select().from(s.jobs)).toHaveLength(0);
      expect(await ctx.db.select().from(s.mappings)).toHaveLength(0);
      expect((await searchJobs({})).total).toBe(0);
      expect((await ctx.db.select().from(s.syncRuns)).some((run) => run.status === 'failed')).toBe(
        true,
      );
    } finally {
      await ctx.client.exec(
        "CREATE OR REPLACE FUNCTION array_to_string_immutable(text[]) RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$ SELECT array_to_string($1, ' ') $$;",
      );
    }
  });
  it('retains commands on queue failure and uses stable queue identities on replay', async () => {
    const source = await enabled();
    await enqueueSource(root, source.id);
    await expect(
      dispatchCommands({
        add: async () => {
          throw new Error('Queue unavailable');
        },
      }),
    ).rejects.toThrow('Queue unavailable');
    const pending = await ctx.db.select().from(s.outbox);
    expect(pending.some((row) => !row.dispatchedAt)).toBe(true);
    const seen: string[] = [];
    await dispatchCommands({
      add: async (_name, _data, options) => {
        seen.push(options.jobId);
      },
    });
    expect(seen.length).toBeGreaterThan(0);
    expect(new Set(seen).size).toBe(seen.length);
    expect((await ctx.db.select().from(s.outbox)).every((row) => row.dispatchedAt)).toBe(true);
  });
  it('enforces one active task per source at the database level', async () => {
    const source = await enabled();
    await enqueueSource(root, source.id);
    await expect(ctx.db.insert(s.ingestionTasks).values({ sourceId: source.id })).rejects.toThrow();
  });
});

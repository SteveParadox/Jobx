import { Queue, QueueEvents, Worker } from 'bullmq';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';
import * as s from '../../src/db/schema';
import {
  registerSource,
  reviewSource,
  changeSourceEnabled,
} from '../../src/domain/source-management';
import { enqueueSource, processIngestionTask } from '../../src/domain/ingestion-tasks';
import { createEmployer, verifyEmployer } from '../../src/domain/jobs';
import { searchJobs } from '../../src/domain/search';
import { dispatchCommands, tickIngestion } from '../../src/worker/ingestion';
import type { Transport } from '../../src/integrations/sources/http';
import { actor, description, testDatabase } from '../helpers';

// Opt-in real broker test. TEST_POSTGRES_URL selects independent PostgreSQL
// connections; otherwise persistence uses migrated PGlite. Neither grants a live source license.
const redisUrl = process.env.TEST_REDIS_URL;
let ctx: Awaited<ReturnType<typeof testDatabase>>;
beforeAll(async () => {
  if (redisUrl) ctx = await testDatabase(process.env.TEST_POSTGRES_URL);
});
afterAll(async () => {
  if (ctx) await ctx.client.close();
});
it.runIf(Boolean(redisUrl))(
  'hands scheduled imports to real BullMQ, survives worker restart, and reconciles closure into search',
  async () => {
    const url = new URL(redisUrl!);
    const connection = {
      host: url.hostname,
      port: Number(url.port || 6379),
      username: decodeURIComponent(url.username) || undefined,
      password: decodeURIComponent(url.password) || undefined,
      ...(url.protocol === 'rediss:' ? { tls: {} } : {}),
      maxRetriesPerRequest: null,
    };
    const name = 'ingestion-fixture-' + crypto.randomUUID();
    const queue = new Queue(name, { connection });
    const events = new QueueEvents(name, { connection });
    let worker: Worker | undefined;
    let payload: unknown = {
      jobs: [
        {
          externalId: 'real-queue-fixture',
          sourceUrl: 'https://careers.example.com/job',
          applyUrl: 'https://careers.example.com/apply',
          title: 'Fixture Queue Engineer',
          descriptionHtml: description,
          locationLabel: 'Lagos, Nigeria',
          country: 'NG',
          workplace: 'onsite',
        },
      ],
    };
    const transport: Transport = async (value) => ({
      url: value,
      status: 200,
      headers: new Headers({
        'content-type': value.endsWith('/robots.txt') ? 'text/plain' : 'application/json',
      }),
      body: value.endsWith('/robots.txt') ? 'User-agent: *\nAllow: /' : JSON.stringify(payload),
    });
    const options = { transport, pace: async () => {} };
    const startWorker = () =>
      new Worker(name, async (job) => processIngestionTask(job.data.taskId, options), {
        connection,
        concurrency: 2,
      });
    try {
      await events.waitUntilReady();
      const root = actor('queue-root', 'admin');
      const owner = actor('queue-owner');
      await ctx.db.insert(s.user).values([root, owner]);
      const employer = await createEmployer(owner, {
        name: 'Queue fixture employer',
        website: 'https://careers.example.com',
      });
      await verifyEmployer(
        root,
        employer.id,
        'verified',
        'Controlled fixture employer verification, no live vacancy.',
      );
      const source = await registerSource(root, {
        employerId: employer.id,
        provider: 'authorized_json',
        boardToken: 'queue-fixture',
        endpointUrl: 'https://careers.example.com/jobs.json',
        applicationHostnames: ['careers.example.com'],
        permissionEvidence: 'Fixture-only recorded permission for the queue integration test.',
        usageConditions: 'Fixture tests only. No commercial redistribution approval.',
        attribution: 'Queue fixture',
        removalPolicy: 'Close after two spaced complete snapshots',
        intervalMinutes: 60,
        permittedFields: ['title', 'description', 'location', 'application'],
        autoPublish: true,
        config: { emptyMeansComplete: true },
      });
      await reviewSource(
        root,
        source.id,
        'approved',
        'Explicit test-only permission and employer verification evidence.',
      );
      const test = await enqueueSource(root, source.id, 'test');
      await processIngestionTask(test.taskId, options);
      await changeSourceEnabled(root.id, source.id, true);
      worker = startWorker();
      await worker.waitUntilReady();
      async function finish(taskId: string) {
        const command = (await ctx.db.select().from(s.outbox)).find(
          (row) => (row.payload as { taskId?: string }).taskId === taskId,
        )!;
        const job = await queue.getJob('outbox-' + command.id);
        expect(job).toBeDefined();
        await job!.waitUntilFinished(events, 30000);
        expect(
          (await ctx.db.select().from(s.ingestionTasks).where(eq(s.ingestionTasks.id, taskId)))[0]
            .status,
        ).toBe('completed');
        return { command, job };
      }
      await tickIngestion(queue);
      const first = (await ctx.db.select().from(s.ingestionTasks)).find(
        (task) => task.kind === 'sync',
      )!;
      const { command, job } = await finish(first.id);
      expect((await searchJobs({ q: 'Queue Engineer' })).total).toBe(1);
      const duplicate = await queue.add('ingestion', command.payload, { jobId: job!.id });
      expect(duplicate.id).toBe(job!.id);
      await worker.close();
      worker = undefined;
      payload = {
        jobs: [
          {
            externalId: 'real-queue-fixture',
            sourceUrl: 'https://careers.example.com/job',
            applyUrl: 'https://careers.example.com/apply',
            title: 'Updated Fixture Queue Engineer',
            descriptionHtml: description,
            locationLabel: 'Lagos, Nigeria',
            country: 'NG',
            workplace: 'onsite',
          },
        ],
      };
      const update = await enqueueSource(root, source.id);
      await dispatchCommands(queue);
      expect((await queue.getJobCounts('waiting')).waiting).toBeGreaterThan(0);
      worker = startWorker();
      await worker.waitUntilReady();
      await finish(update.taskId);
      expect((await searchJobs({ q: 'Updated Fixture' })).total).toBe(1);
      expect(await ctx.db.select().from(s.jobs)).toHaveLength(1);
      payload = { jobs: [] };
      const missing = await enqueueSource(root, source.id);
      await dispatchCommands(queue);
      await finish(missing.taskId);
      expect((await searchJobs({})).total).toBe(1);
      await ctx.db.update(s.mappings).set({ lastMissingAt: new Date(Date.now() - 7200000) });
      const closed = await enqueueSource(root, source.id);
      await dispatchCommands(queue);
      await finish(closed.taskId);
      expect((await searchJobs({})).total).toBe(0);
      expect((await ctx.db.select().from(s.jobs))[0].status).toBe('closed');
    } finally {
      await worker?.close();
      await events.close();
      await queue.obliterate({ force: true });
      await queue.close();
    }
  },
  60000,
);

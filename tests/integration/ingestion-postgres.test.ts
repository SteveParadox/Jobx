import { eq, and } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PoolClient } from 'pg';
import * as s from '../../src/db/schema';
import { syncSource } from '../../src/domain/ingestion';
import {
  controlIngestionTask,
  enqueueSource,
  processIngestionTask,
  recoverIngestionTasks,
} from '../../src/domain/ingestion-tasks';
import { createEmployer, verifyEmployer } from '../../src/domain/jobs';
import {
  registerSource,
  reviewSource,
  changeSourceEnabled,
} from '../../src/domain/source-management';
import { SourceError } from '../../src/integrations/sources/contracts';
import type { Transport } from '../../src/integrations/sources/http';
import { actor, description } from '../helpers';
import { testPostgresDatabase } from '../postgres';

// These cases require independent server connections and intentionally stay
// skipped under PGlite. Never point TEST_POSTGRES_URL at a production database.
describe.runIf(Boolean(process.env.TEST_POSTGRES_URL))('PostgreSQL ingestion lock ordering', () => {
  let ctx: Awaited<ReturnType<typeof testPostgresDatabase>>;
  const root = actor('postgres-root', 'admin');
  const owner = actor('postgres-owner');
  let sourceId: string;
  const transport: Transport = async (url) => ({
    url,
    status: 200,
    headers: new Headers({
      'content-type': url.endsWith('/robots.txt') ? 'text/plain' : 'application/json',
    }),
    body: url.endsWith('/robots.txt')
      ? 'User-agent: *\nAllow: /'
      : JSON.stringify({
          jobs: [
            {
              externalId: 'postgres-fixture',
              sourceUrl: 'https://careers.example.com/job',
              applyUrl: 'https://careers.example.com/apply',
              title: 'Fixture Database Engineer',
              descriptionHtml: description,
              locationLabel: 'Lagos, Nigeria',
              country: 'NG',
              workplace: 'onsite',
            },
          ],
        }),
  });
  beforeAll(async () => {
    ctx = await testPostgresDatabase(process.env.TEST_POSTGRES_URL!);
  });
  afterAll(async () => {
    await ctx?.client.close();
  });
  beforeEach(async () => {
    await ctx.client.exec(
      'TRUNCATE users, employers, source_host_budgets RESTART IDENTITY CASCADE',
    );
    await ctx.db.insert(s.user).values([root, owner]);
    const employer = await createEmployer(owner, {
      name: 'PostgreSQL fixture employer',
      website: 'https://careers.example.com',
    });
    await verifyEmployer(
      root,
      employer.id,
      'verified',
      'Recorded verification for database fixtures only.',
    );
    const source = await registerSource(root, {
      employerId: employer.id,
      provider: 'authorized_json',
      boardToken: 'postgres-fixture',
      endpointUrl: 'https://careers.example.com/jobs.json',
      applicationHostnames: ['careers.example.com'],
      permissionEvidence: 'Recorded fixture permission only, never live source approval.',
      usageConditions: 'Tests only; no commercial redistribution authority.',
      attribution: 'PostgreSQL fixture',
      removalPolicy: 'Close only after confirmed complete snapshots.',
      intervalMinutes: 60,
      permittedFields: ['title', 'description', 'location', 'application'],
      autoPublish: true,
      config: { emptyMeansComplete: true },
    });
    sourceId = source.id;
    await reviewSource(
      root,
      source.id,
      'approved',
      'Explicit fixture-only source contract verification.',
    );
    const test = await enqueueSource(root, source.id, 'test');
    await processIngestionTask(test.taskId, { transport, pace: async () => {} });
    await changeSourceEnabled(root.id, source.id, true);
  });
  async function holdSource() {
    const holder = await ctx.pool.connect();
    try {
      await holder.query('BEGIN');
      await holder.query('SELECT id FROM job_sources WHERE id=$1 FOR UPDATE', [sourceId]);
      return holder;
    } catch (error) {
      try {
        await holder.query('ROLLBACK');
      } finally {
        holder.release();
      }
      throw error;
    }
  }
  async function release(holder: PoolClient) {
    try {
      await holder.query('ROLLBACK');
    } finally {
      holder.release();
    }
  }
  async function blocked() {
    const { rows } = await ctx.pool.query(
      "SELECT pid FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock'",
      [ctx.applicationName],
    );
    return rows.length > 0;
  }
  async function canLock(table: 'ingestion_tasks' | 'source_sync_runs', id: string) {
    const probe = await ctx.pool.connect();
    try {
      await probe.query('BEGIN');
      // Table names are fixed literals, never source/admin input.
      await probe.query(`SELECT id FROM ${table} WHERE id=$1 FOR UPDATE NOWAIT`, [id]);
    } finally {
      await release(probe);
    }
  }
  it('waits for the source before locking a task for manual retry', async () => {
    const task = await enqueueSource(root, sourceId);
    await controlIngestionTask(root, task.taskId, 'cancel');
    const holder = await holdSource();
    const retry = controlIngestionTask(root, task.taskId, 'retry');
    try {
      await vi.waitFor(async () => expect(await blocked()).toBe(true), {
        timeout: 3000,
        interval: 20,
      });
      await canLock('ingestion_tasks', task.taskId);
    } finally {
      await release(holder);
      await retry;
    }
    expect(
      (await ctx.db.select().from(s.ingestionTasks).where(eq(s.ingestionTasks.id, task.taskId)))[0]
        .status,
    ).toBe('queued');
  });
  it('skips a locked source without claiming its recoverable task', async () => {
    const task = await enqueueSource(root, sourceId);
    const holder = await holdSource();
    let result: number | undefined;
    const recovery = recoverIngestionTasks().then((count) => {
      result = count;
    });
    try {
      await vi.waitFor(async () => expect(result !== undefined || (await blocked())).toBe(true), {
        timeout: 3000,
        interval: 20,
      });
      expect(result).toBe(0);
      await canLock('ingestion_tasks', task.taskId);
    } finally {
      await release(holder);
      await recovery;
    }
  });
  it('waits for the source before locking a failed sync run', async () => {
    const entered = Promise.withResolvers<void>();
    const resume = Promise.withResolvers<void>();
    const failure = syncSource(sourceId, fetch, undefined, {
      pace: async () => {},
      transport: async () => {
        entered.resolve();
        await resume.promise;
        throw new SourceError('NETWORK', 'Recorded connection failure', true);
      },
    }).then(
      () => null,
      (error: unknown) => error,
    );
    await entered.promise;
    const [run] = await ctx.db
      .select()
      .from(s.syncRuns)
      .where(and(eq(s.syncRuns.sourceId, sourceId), eq(s.syncRuns.status, 'fetching')));
    const holder = await holdSource();
    try {
      resume.resolve();
      await vi.waitFor(async () => expect(await blocked()).toBe(true), {
        timeout: 3000,
        interval: 20,
      });
      await canLock('source_sync_runs', run.id);
    } finally {
      resume.resolve();
      await release(holder);
      await failure;
    }
    expect(await failure).toMatchObject({ code: 'NETWORK' });
  });
});

import { spawn, type ChildProcess } from 'node:child_process';
import { Queue } from 'bullmq';
import { eq } from 'drizzle-orm';
import { expect, it, vi } from 'vitest';
import * as s from '../../src/db/schema';
import { testPostgresDatabase } from '../postgres';

it.runIf(Boolean(process.env.TEST_POSTGRES_URL && process.env.TEST_REDIS_URL))(
  'the persistent worker dispatches discovery separately and recovers a stale run after process restart',
  async () => {
    const ctx = await testPostgresDatabase(process.env.TEST_POSTGRES_URL!);
    const broker = new URL(process.env.TEST_REDIS_URL!);
    const queue = new Queue('careeratlas', {
      connection: {
        host: broker.hostname,
        port: Number(broker.port || 6379),
        username: decodeURIComponent(broker.username) || undefined,
        password: decodeURIComponent(broker.password) || undefined,
        ...(broker.protocol === 'rediss:' ? { tls: {} } : {}),
        maxRetriesPerRequest: null,
      },
    });
    const database = new URL(process.env.TEST_POSTGRES_URL!);
    database.pathname = '/' + ctx.databaseName;
    let worker: ChildProcess | undefined;
    let output = '';
    let ownsQueue = false;
    const start = () => {
      const child = spawn(process.execPath, ['--import', 'tsx', 'src/worker/main.ts'], {
        env: {
          ...process.env,
          APP_ENV: 'test',
          DEMO_MODE: 'false',
          DATABASE_URL: database.toString(),
          REDIS_URL: process.env.TEST_REDIS_URL,
          JOB_DISCOVERY_ENABLED: 'true',
          // Rejected before any network request: recovery never crawls a live source.
          JOB_DISCOVERY_SEEDS: 'https://localhost',
          JOB_DISCOVERY_INTERVAL_MINUTES: '15',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      child.stdout?.on('data', (chunk) => {
        output += chunk.toString();
      });
      child.stderr?.on('data', (chunk) => {
        output += chunk.toString();
      });
      return child;
    };
    const stop = async (signal: NodeJS.Signals) => {
      if (!worker || worker.exitCode !== null || worker.signalCode !== null) return;
      const current = worker;
      const closed = new Promise<void>((resolve) => current.once('exit', () => resolve()));
      current.kill(signal);
      await closed;
    };
    try {
      // This process test uses the application's fixed queue name. Refuse an occupied
      // broker rather than consuming or erasing somebody else's queued application work.
      const counts = await queue.getJobCounts();
      expect(Object.values(counts).every((count) => count === 0)).toBe(true);
      expect(await queue.getJobSchedulers()).toHaveLength(0);
      ownsQueue = true;
      worker = start();
      await vi.waitFor(
        async () => {
          const runs = await ctx.db.select().from(s.discoveryRuns);
          expect(
            runs.some((run) => run.status === 'failed'),
            output,
          ).toBe(true);
          expect(await ctx.db.select().from(s.workerHeartbeat)).toHaveLength(1);
        },
        { timeout: 15000, interval: 100 },
      );
      const firstHeartbeat = (await ctx.db.select().from(s.workerHeartbeat))[0].updatedAt;
      await stop('SIGKILL');
      const [stale] = await ctx.db
        .insert(s.discoveryRuns)
        .values({
          trigger: 'worker-crash-fixture',
          status: 'running',
          seedsSeen: 1,
          startedAt: new Date(Date.now() - 31 * 60_000),
        })
        .returning();
      // Queue work while no process is alive; the replacement must consume it.
      await queue.add('discovery', {}, { jobId: 'restart-fixture-' + crypto.randomUUID() });
      worker = start();
      await vi.waitFor(
        async () => {
          const [run] = await ctx.db
            .select()
            .from(s.discoveryRuns)
            .where(eq(s.discoveryRuns.id, stale.id));
          expect(run.status, output).toBe('failed');
          const [heartbeat] = await ctx.db.select().from(s.workerHeartbeat);
          expect(heartbeat.updatedAt.getTime()).toBeGreaterThan(firstHeartbeat.getTime());
        },
        { timeout: 15000, interval: 100 },
      );
      expect(output).toContain('discovery_seed_rejected');
      await stop('SIGTERM');
    } finally {
      await stop('SIGKILL');
      if (ownsQueue) {
        await queue.removeJobScheduler('platform-tick');
        await queue.obliterate({ force: true });
      }
      await queue.close();
      await ctx.client.close();
    }
  },
  45000,
);

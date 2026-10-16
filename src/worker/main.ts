import { closeDb, getDb } from '@/db';
import * as s from '@/db/schema';
import { pruneSearchHistory } from '@/domain/candidates';
import { pruneRawPayloads, syncSource } from '@/domain/ingestion';
import { processIngestionTask } from '@/domain/ingestion-tasks';
import { expireSourceAuthorizations } from '@/domain/source-management';
import { expireJobs } from '@/domain/jobs';
import { deliverNotification, generateDigests } from '@/domain/notifications';
import { submitIndexing } from '@/integrations/indexing';
import { assertRuntime, env } from '@/lib/config';
import { log } from '@/lib/log';
import { queueConnection } from '@/lib/queue';
import { Queue, Worker } from 'bullmq';
import { and, eq, inArray, lt } from 'drizzle-orm';
import { tickIngestion } from './ingestion';
assertRuntime();
const connection = queueConnection();
const queue = new Queue('careeratlas', {
  connection,
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: 'exponential', delay: 30000, jitter: 0.25 },
    removeOnComplete: { age: 86400, count: 1000 },
    removeOnFail: { age: 7 * 86400, count: 1000 },
  },
});
async function tick() {
  const db = getDb();
  await expireJobs();
  await expireSourceAuthorizations();
  await generateDigests();
  await pruneRawPayloads();
  await pruneSearchHistory();
  await tickIngestion(queue);
  const pending = await db
    .select({ id: s.deliveries.id })
    .from(s.deliveries)
    .where(and(inArray(s.deliveries.status, ['pending', 'sending']), lt(s.deliveries.attempts, 5)))
    .limit(100);
  for (const d of pending) await queue.add('email', d, { jobId: 'email-' + d.id });
  if (env.GOOGLE_INDEXING_ENABLED) {
    const requests = await db
      .select({ id: s.indexingNotifications.id })
      .from(s.indexingNotifications)
      .where(
        and(eq(s.indexingNotifications.status, 'pending'), lt(s.indexingNotifications.attempts, 5)),
      )
      .limit(10);
    for (const item of requests)
      await queue.add('index', item, {
        jobId: 'index-' + item.id + '-' + new Date().toISOString().slice(0, 10),
      });
  }
  await db
    .insert(s.workerHeartbeat)
    .values({ id: 'primary' })
    .onConflictDoUpdate({ target: s.workerHeartbeat.id, set: { updatedAt: new Date() } });
}
const worker = new Worker(
  'careeratlas',
  async (job) => {
    switch (job.name) {
      case 'tick':
        return tick();
      case 'import':
        return syncSource(job.data.sourceId, fetch, job.data.records);
      case 'sync':
        return syncSource(job.data.id);
      case 'ingestion':
        return processIngestionTask(job.data.taskId);
      case 'email':
        return deliverNotification(job.data.id);
      case 'index':
        return submitIndexing(job.data.id);
      default:
        throw new Error('Unknown background task');
    }
  },
  { connection, concurrency: 4, limiter: { max: 30, duration: 60000 } },
);
worker.on('failed', (job, error) =>
  log('worker_job_failed', { jobId: job?.id, task: job?.name, error: error.message }),
);
worker.on('error', (error) => log('worker_error', { error: error.message }));
await queue.upsertJobScheduler('platform-tick', { every: 60000 }, { name: 'tick', data: {} });
await queue.add('tick', {}, { jobId: 'startup-' + Date.now() });
log('worker_started');
let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  await worker.close();
  await queue.close();
  await closeDb();
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

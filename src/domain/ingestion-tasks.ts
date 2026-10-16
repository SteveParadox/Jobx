import { getDb } from '@/db';
import * as s from '@/db/schema';
import { SourceError, type FeedJob } from '@/integrations/sources/contracts';
import { delay } from '@/integrations/sources/http';
import { admin, type Actor } from '@/lib/auth';
import { AppError, requireValue } from '@/lib/errors';
import { and, desc, eq, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { syncSource, type SyncOptions } from './ingestion';
import { audit, type Tx } from './jobs';
import { assertSourceApproved } from './source-management';

const activeStates = ['queued', 'running', 'retrying'];
async function command(tx: Tx, id: string, attempt: number, replay = '') {
  await tx
    .insert(s.outbox)
    .values({
      topic: 'ingestion',
      payload: { taskId: id },
      dedupeKey: `ingestion:${id}:${attempt}${replay ? ':' + replay : ''}`,
    })
    .onConflictDoNothing();
}
export async function enqueueSource(
  actor: Actor,
  sourceId: string,
  kind: 'sync' | 'test' | 'import' = 'sync',
  records?: FeedJob[],
) {
  admin(actor);
  return getDb().transaction(async (tx) => {
    const source = requireValue(
      (await tx.select().from(s.sources).where(eq(s.sources.id, sourceId)).for('update'))[0],
    );
    assertSourceApproved(source);
    if (kind !== 'test' && !source.enabled)
      throw new AppError(409, 'Enable the approved source before importing');
    if (source.provider.startsWith('manual_') !== (kind === 'import'))
      throw new AppError(400, 'This source requires the matching upload/network workflow');
    const [existing] = await tx
      .select()
      .from(s.ingestionTasks)
      .where(
        and(
          eq(s.ingestionTasks.sourceId, sourceId),
          inArray(s.ingestionTasks.status, activeStates),
        ),
      );
    if (existing) return { queued: true, taskId: existing.id, alreadyQueued: true };
    const [task] = await tx
      .insert(s.ingestionTasks)
      .values({ sourceId, kind, payload: records ? { records } : null })
      .returning();
    await command(tx, task.id, 0);
    await audit(tx, actor.id, 'source.task_queued', sourceId, { taskId: task.id, kind });
    return { queued: true, taskId: task.id, alreadyQueued: false };
  });
}
export async function scheduleSources(now = new Date()) {
  return getDb().transaction(async (tx) => {
    const due = await tx
      .select()
      .from(s.sources)
      .where(
        and(
          eq(s.sources.enabled, true),
          eq(s.sources.approvalStatus, 'approved'),
          sql`${s.sources.provider} not like 'manual_%'`,
          sql`${s.sources.health}<>'dead_letter'`,
          or(isNull(s.sources.nextSyncAt), lte(s.sources.nextSyncAt, now)),
          or(
            isNull(s.sources.authorizationExpiresAt),
            sql`${s.sources.authorizationExpiresAt}>${now}`,
          ),
        ),
      )
      .orderBy(s.sources.nextSyncAt)
      .limit(100)
      .for('update', { skipLocked: true });
    let queued = 0;
    for (const source of due) {
      const [existing] = await tx
        .select()
        .from(s.ingestionTasks)
        .where(
          and(
            eq(s.ingestionTasks.sourceId, source.id),
            inArray(s.ingestionTasks.status, activeStates),
          ),
        );
      if (existing) continue;
      const [task] = await tx.insert(s.ingestionTasks).values({ sourceId: source.id }).returning();
      await command(tx, task.id, 0);
      await tx
        .update(s.sources)
        .set({ nextSyncAt: new Date(now.getTime() + source.intervalMinutes * 60000) })
        .where(eq(s.sources.id, source.id));
      queued++;
    }
    return queued;
  });
}
export async function paceSourceHost(hostname: string, interval: number, signal: AbortSignal) {
  const wait = await getDb().transaction(async (tx) => {
    await tx.insert(s.sourceHostBudgets).values({ hostname }).onConflictDoNothing();
    const [budget] = await tx
      .select()
      .from(s.sourceHostBudgets)
      .where(eq(s.sourceHostBudgets.hostname, hostname))
      .for('update');
    const now = Date.now();
    const reserved = Math.max(now, budget.nextRequestAt.getTime());
    await tx
      .update(s.sourceHostBudgets)
      .set({ nextRequestAt: new Date(reserved + Math.max(interval, 500)) })
      .where(eq(s.sourceHostBudgets.hostname, hostname));
    return reserved - now;
  });
  if (wait) await delay(wait, signal);
}
export function ingestionBackoff(attempt: number, random = Math.random) {
  return Math.min(3600000, 30000 * 2 ** Math.max(0, attempt - 1) * (0.75 + random() * 0.5));
}
export async function processIngestionTask(id: string, options: SyncOptions = {}) {
  const db = getDb();
  const leaseToken = crypto.randomUUID();
  const task = await db.transaction(async (tx) => {
    const [old] = await tx
      .select()
      .from(s.ingestionTasks)
      .where(eq(s.ingestionTasks.id, id))
      .for('update');
    if (!old || !['queued', 'retrying'].includes(old.status) || old.availableAt > new Date())
      return null;
    if (old.cancelRequested) {
      await tx
        .update(s.ingestionTasks)
        .set({ status: 'cancelled', finishedAt: new Date() })
        .where(eq(s.ingestionTasks.id, id));
      return null;
    }
    const [claimed] = await tx
      .update(s.ingestionTasks)
      .set({
        status: 'running',
        attempts: old.attempts + 1,
        leaseToken,
        leaseUntil: new Date(Date.now() + 600000),
        startedAt: new Date(),
      })
      .where(eq(s.ingestionTasks.id, id))
      .returning();
    return claimed;
  });
  if (!task) return { skipped: true };
  try {
    const checkCancelled = async () => {
      const [current] = await db.select().from(s.ingestionTasks).where(eq(s.ingestionTasks.id, id));
      if (
        !current ||
        current.cancelRequested ||
        current.leaseToken !== leaseToken ||
        current.status !== 'running'
      )
        throw new SourceError('CANCELLED', 'Task cancellation or superseded worker lease');
      await options.checkCancelled?.();
    };
    const result = await syncSource(
      task.sourceId,
      fetch,
      task.kind === 'import' ? (task.payload as { records: FeedJob[] })?.records : undefined,
      {
        ...options,
        taskId: id,
        taskLeaseToken: leaseToken,
        testOnly: task.kind === 'test',
        checkCancelled,
        pace: options.pace ?? paceSourceHost,
      },
    );
    await db
      .update(s.ingestionTasks)
      .set({
        status: 'completed',
        result,
        leaseToken: null,
        leaseUntil: null,
        finishedAt: new Date(),
        payload: null,
      })
      .where(and(eq(s.ingestionTasks.id, id), eq(s.ingestionTasks.leaseToken, leaseToken)));
    return result;
  } catch (error) {
    const sourceError =
      error instanceof SourceError
        ? error
        : new SourceError('PERSISTENCE', 'Database or processing failure', true);
    const cancelled =
      sourceError.code === 'CANCELLED' ||
      sourceError.code === 'DISABLED' ||
      sourceError.code === 'NOT_APPROVED';
    const retry = !cancelled && sourceError.retryable && task.attempts < task.maxAttempts;
    const availableAt = new Date(
      Date.now() + Math.max(sourceError.retryAfterMs ?? 0, ingestionBackoff(task.attempts)),
    );
    const settled = await db.transaction(async (tx) => {
      const [owned] = await tx
        .update(s.ingestionTasks)
        .set({
          status: cancelled ? 'cancelled' : retry ? 'retrying' : 'failed',
          availableAt,
          lastError: sourceError.message.slice(0, 1000),
          errorCode: sourceError.code,
          leaseToken: null,
          leaseUntil: null,
          finishedAt: retry ? null : new Date(),
        })
        .where(and(eq(s.ingestionTasks.id, id), eq(s.ingestionTasks.leaseToken, leaseToken)))
        .returning({ id: s.ingestionTasks.id });
      // A recovered/reclaimed task belongs to its new worker. Its predecessor must
      // not reschedule the source or move a healthy source into dead-letter state.
      if (!owned) return false;
      if (retry)
        await tx
          .update(s.sources)
          .set({ nextSyncAt: availableAt })
          .where(eq(s.sources.id, task.sourceId));
      else if (!cancelled)
        await tx
          .update(s.sources)
          .set({ health: 'dead_letter', nextSyncAt: null })
          .where(eq(s.sources.id, task.sourceId));
      return true;
    });
    if (!settled) return { skipped: true };
    return {
      status: cancelled ? 'cancelled' : retry ? 'retrying' : 'failed',
      code: sourceError.code,
    };
  }
}
export async function recoverIngestionTasks(now = new Date()) {
  return getDb().transaction(async (tx) => {
    const tasks = await tx
      .select()
      .from(s.ingestionTasks)
      .where(
        or(
          and(eq(s.ingestionTasks.status, 'running'), lte(s.ingestionTasks.leaseUntil, now)),
          and(
            inArray(s.ingestionTasks.status, ['queued', 'retrying']),
            lte(s.ingestionTasks.availableAt, now),
          ),
        ),
      )
      .limit(200)
      .for('update', { skipLocked: true });
    for (const task of tasks) {
      const terminal = task.cancelRequested || task.attempts >= task.maxAttempts;
      // Close the abandoned attempt even when no replay is allowed. Otherwise
      // the dashboard and source lease retain a running attempt indefinitely.
      if (task.status === 'running') {
        await tx
          .update(s.syncRuns)
          .set({
            status: task.cancelRequested ? 'cancelled' : 'failed',
            error: terminal
              ? 'Worker lease expired; cancelled or retry budget exhausted'
              : 'Worker lease expired; replay scheduled',
            finishedAt: now,
          })
          .where(
            and(
              eq(s.syncRuns.taskId, task.id),
              inArray(s.syncRuns.status, ['fetching', 'persisting']),
            ),
          );
        await tx
          .update(s.sources)
          .set({ syncLeaseToken: null, syncLeaseUntil: null })
          .where(and(eq(s.sources.id, task.sourceId), lte(s.sources.syncLeaseUntil, now)));
      }
      if (terminal) {
        await tx
          .update(s.ingestionTasks)
          .set({
            status: task.cancelRequested ? 'cancelled' : 'failed',
            finishedAt: now,
            leaseToken: null,
            leaseUntil: null,
            lastError: 'Cancelled or retry budget exhausted during recovery',
            errorCode: task.cancelRequested ? 'CANCELLED' : 'WORKER_LOST',
          })
          .where(eq(s.ingestionTasks.id, task.id));
        if (!task.cancelRequested)
          await tx
            .update(s.sources)
            .set({ health: 'dead_letter', nextSyncAt: null })
            .where(eq(s.sources.id, task.sourceId));
        continue;
      }
      if (task.status === 'running') {
        await tx
          .update(s.ingestionTasks)
          .set({
            status: 'retrying',
            availableAt: now,
            leaseToken: null,
            leaseUntil: null,
            lastError: 'Worker lease expired; replay scheduled',
            errorCode: 'WORKER_LOST',
          })
          .where(eq(s.ingestionTasks.id, task.id));
      }
      const [lastCommand] = await tx
        .select()
        .from(s.outbox)
        .where(sql`${s.outbox.dedupeKey} like ${'ingestion:' + task.id + ':%'}`)
        .orderBy(desc(s.outbox.createdAt), desc(s.outbox.id))
        .limit(1);
      const prefix = `ingestion:${task.id}:${task.attempts}`;
      const currentAttemptQueued =
        lastCommand &&
        (lastCommand.dedupeKey === prefix || lastCommand.dedupeKey.startsWith(prefix + ':'));
      if (!currentAttemptQueued || task.status === 'running')
        await command(tx, task.id, task.attempts);
      else if (
        lastCommand.dispatchedAt &&
        lastCommand.dispatchedAt.getTime() < now.getTime() - 600000
      )
        await command(tx, task.id, task.attempts, 'recovery-' + Math.floor(now.getTime() / 600000));
    }
    return tasks.length;
  });
}
export async function controlIngestionTask(actor: Actor, id: string, action: 'cancel' | 'retry') {
  admin(actor);
  return getDb().transaction(async (tx) => {
    const task = requireValue(
      (
        await tx.select().from(s.ingestionTasks).where(eq(s.ingestionTasks.id, id)).for('update')
      )[0],
    );
    if (action === 'cancel') {
      if (!activeStates.includes(task.status)) throw new AppError(409, 'Task is already finished');
      await tx
        .update(s.ingestionTasks)
        .set({
          cancelRequested: true,
          ...(task.status !== 'running' ? { status: 'cancelled', finishedAt: new Date() } : {}),
        })
        .where(eq(s.ingestionTasks.id, id));
    } else {
      if (!['failed', 'cancelled'].includes(task.status))
        throw new AppError(409, 'Only finished failed/cancelled tasks may be retried');
      const source = requireValue(
        (await tx.select().from(s.sources).where(eq(s.sources.id, task.sourceId)).for('update'))[0],
      );
      assertSourceApproved(source);
      if (task.kind !== 'test' && !source.enabled) throw new AppError(409, 'Source is disabled');
      if (task.kind === 'import' && !task.payload)
        throw new AppError(409, 'Upload payload retention expired; submit a new complete import');
      const [existing] = await tx
        .select()
        .from(s.ingestionTasks)
        .where(
          and(
            eq(s.ingestionTasks.sourceId, task.sourceId),
            inArray(s.ingestionTasks.status, activeStates),
          ),
        );
      if (existing) throw new AppError(409, 'This source already has an active task');
      await tx
        .update(s.ingestionTasks)
        .set({
          status: 'queued',
          cancelRequested: false,
          availableAt: new Date(),
          maxAttempts: task.attempts + 5,
          finishedAt: null,
        })
        .where(eq(s.ingestionTasks.id, id));
      await command(tx, id, task.attempts, 'manual-' + crypto.randomUUID());
    }
    await audit(tx, actor.id, 'source.task_' + action, task.sourceId, { taskId: id });
    return { saved: true };
  });
}
export async function ingestionOverview() {
  const db = getDb();
  const [tasks, runs, errors, heartbeat] = await Promise.all([
    db.select().from(s.ingestionTasks).orderBy(desc(s.ingestionTasks.createdAt)).limit(100),
    db.select().from(s.syncRuns).orderBy(desc(s.syncRuns.startedAt)).limit(100),
    db
      .select({
        id: s.ingestionErrors.id,
        runId: s.ingestionErrors.runId,
        stage: s.ingestionErrors.stage,
        reason: s.ingestionErrors.reason,
        externalId: s.ingestionErrors.externalId,
        disposition: s.ingestionErrors.disposition,
      })
      .from(s.ingestionErrors)
      .orderBy(desc(s.ingestionErrors.createdAt))
      .limit(100),
    db.select().from(s.workerHeartbeat),
  ]);
  return {
    tasks: tasks.map(({ payload: _payload, ...task }) => {
      void _payload;
      return task;
    }),
    runs,
    errors,
    heartbeat,
  };
}

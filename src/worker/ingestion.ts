import { getDb } from '@/db';
import * as s from '@/db/schema';
import { recoverIngestionTasks, scheduleSources } from '@/domain/ingestion-tasks';
import { and, eq, isNull, ne } from 'drizzle-orm';
export type TaskQueue = {
  add: (
    name: string,
    payload: unknown,
    options: { jobId: string; attempts?: number },
  ) => Promise<unknown>;
};
export async function dispatchCommands(queue: TaskQueue, now = new Date()) {
  const db = getDb();
  // Reserve a bounded dispatch budget for both normal ingestion and privacy cleanup.
  // A storage outage must not starve new ingestion; a busy ingestion queue must not
  // prevent previously requested document deletions from being retried.
  const [regular, cleanup] = await Promise.all([
    db
      .select()
      .from(s.outbox)
      .where(and(isNull(s.outbox.dispatchedAt), ne(s.outbox.topic, 'storage-delete')))
      .orderBy(s.outbox.id)
      .limit(80),
    db
      .select()
      .from(s.outbox)
      .where(and(isNull(s.outbox.dispatchedAt), eq(s.outbox.topic, 'storage-delete')))
      .orderBy(s.outbox.id)
      .limit(20),
  ]);
  const commands = [...regular, ...cleanup];
  for (const command of commands) {
    const isStorageDeletion = command.topic === 'storage-delete';
    // Storage deletions are acknowledged only *after* S3 confirms deletion.
    // Replaying with a fresh hourly job ID lets jobs exhausted by a prolonged
    // storage outage recover without manually changing database records.
    const jobId = isStorageDeletion
      ? 'outbox-' + command.id + '-retry-' + Math.floor(now.getTime() / 3600000)
      : 'outbox-' + command.id;
    const payload = isStorageDeletion
      ? { ...(command.payload as Record<string, unknown>), commandId: command.id }
      : command.payload;
    await queue.add(command.topic, payload, {
      jobId,
      ...(command.topic === 'ingestion' ? { attempts: 1 } : {}),
    });
    if (!isStorageDeletion) {
      // Other command types acknowledge durable queue submission, not completion.
      await db.update(s.outbox)
        .set({ dispatchedAt: new Date() })
        .where(eq(s.outbox.id, command.id));
    }
  }
  return commands.length;
}
export async function tickIngestion(queue: TaskQueue) {
  await recoverIngestionTasks();
  await scheduleSources();
  return dispatchCommands(queue);
}

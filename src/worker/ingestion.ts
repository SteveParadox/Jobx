import { getDb } from '@/db';
import * as s from '@/db/schema';
import { recoverIngestionTasks, scheduleSources } from '@/domain/ingestion-tasks';
import { eq, isNull } from 'drizzle-orm';
export type TaskQueue = {
  add: (
    name: string,
    payload: unknown,
    options: { jobId: string; attempts?: number },
  ) => Promise<unknown>;
};
export async function dispatchCommands(queue: TaskQueue) {
  const db = getDb();
  const commands = await db
    .select()
    .from(s.outbox)
    .where(isNull(s.outbox.dispatchedAt))
    .orderBy(s.outbox.id)
    .limit(100);
  for (const command of commands) {
    await queue.add(command.topic, command.payload, {
      jobId: 'outbox-' + command.id,
      ...(command.topic === 'ingestion' ? { attempts: 1 } : {}),
    });
    // A crash between add and ack safely repeats the same BullMQ identity.
    await db.update(s.outbox).set({ dispatchedAt: new Date() }).where(eq(s.outbox.id, command.id));
  }
  return commands.length;
}
export async function tickIngestion(queue: TaskQueue) {
  await recoverIngestionTasks();
  await scheduleSources();
  return dispatchCommands(queue);
}

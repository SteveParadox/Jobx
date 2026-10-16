import { Queue } from 'bullmq';
import { env } from './config';
import { log } from './log';
export function queueConnection() {
  if (!env.REDIS_URL) throw new Error('Redis is not configured');
  const url = new URL(env.REDIS_URL);
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    username: decodeURIComponent(url.username) || undefined,
    password: decodeURIComponent(url.password) || undefined,
    ...(url.protocol === 'rediss:' ? { tls: {} } : {}),
    maxRetriesPerRequest: null,
  };
}
let queue: Queue | undefined;
export async function queueHealth() {
  if (!env.REDIS_URL) return { available: false, counts: null };
  try {
    if (!queue) {
      queue = new Queue('careeratlas', { connection: queueConnection() });
      queue.on('error', (error) => log('queue_connection_error', { error: error.name }));
    }
    const counts = await Promise.race([
      queue.getJobCounts('waiting', 'active', 'delayed', 'failed', 'completed'),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Queue health timeout')), 3000),
      ),
    ]);
    return { available: true, counts };
  } catch {
    return { available: false, counts: null };
  }
}

import { getDb } from '@/db';
import { getRedis } from '@/lib/http';
import { sql } from 'drizzle-orm';
export async function GET() {
  try {
    await Promise.all([getDb().execute(sql`select 1`), getRedis().ping()]);
    const result = await getDb().execute<{ fresh: boolean }>(
      sql`select exists(select 1 from worker_heartbeat where updated_at>now()-interval '3 minutes') as fresh`,
    );
    if (!result.rows[0].fresh) throw new Error('Worker is not ready');
    return Response.json({ status: 'ready' }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json(
      { status: 'not_ready' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs' && process.env.APP_ENV === 'production') {
    const { assertRuntime } = await import('./lib/config');
    assertRuntime();
    const { getDb } = await import('./db');
    const { sql } = await import('drizzle-orm');
    const result = await getDb().execute<{ unsafe: boolean }>(
      sql`select exists(select 1 from users where id in ('demo-candidate','demo-employer','demo-admin')) or exists(select 1 from employers where is_demo=true) as unsafe`,
    );
    if (result.rows[0].unsafe)
      throw new Error('Production requires an isolated database without demo users or employers');
  }
}

import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { readFile } from 'node:fs/promises';
import { setTestDb } from '../src/db';
import * as schema from '../src/db/schema';

// Explicit opt-in only. Each invocation gets its own database and independent pool
// connections, so row-lock behavior is PostgreSQL's rather than PGlite's queue.
export async function testPostgresDatabase(connectionString: string) {
  if (process.env.APP_ENV !== 'test') throw new Error('PostgreSQL fixtures require APP_ENV=test');
  const databaseName = 'jobx_test_' + crypto.randomUUID().replaceAll('-', '');
  const applicationName = 'jobx-test-' + crypto.randomUUID();
  const setup = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 5000 });
  let pool: Pool | undefined;
  let created = false;
  try {
    // Exact migrations contain public-qualified foreign keys. A separate database
    // preserves them without rewriting SQL or touching the supplied database's data.
    await setup.query(`CREATE DATABASE "${databaseName}"`);
    created = true;
    const isolatedUrl = new URL(connectionString);
    isolatedUrl.pathname = '/' + databaseName;
    pool = new Pool({
      connectionString: isolatedUrl.toString(),
      max: 10,
      application_name: applicationName,
      connectionTimeoutMillis: 5000,
      statement_timeout: 10000,
      lock_timeout: 5000,
    });
    const journal = JSON.parse(await readFile('drizzle/meta/_journal.json', 'utf8'));
    for (const item of journal.entries)
      await pool.query(await readFile(`drizzle/${item.tag}.sql`, 'utf8'));
    const db = drizzle(pool, { schema });
    setTestDb(db);
    const testPool = pool;
    let closed = false;
    return {
      db,
      pool: testPool,
      databaseName,
      applicationName,
      client: {
        exec: async (query: string) => {
          await testPool.query(query);
        },
        close: async () => {
          if (closed) return;
          closed = true;
          await testPool.end();
          try {
            await setup.query(`DROP DATABASE "${databaseName}"`);
          } finally {
            await setup.end();
          }
        },
      },
    };
  } catch (error) {
    await pool?.end();
    try {
      if (created) await setup.query(`DROP DATABASE "${databaseName}"`);
    } finally {
      await setup.end();
    }
    throw error;
  }
}

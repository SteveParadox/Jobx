import { env } from '@/lib/config';
import { AppError } from '@/lib/errors';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';
export type Database = NodePgDatabase<typeof schema>;
let instance: Database | undefined;
let pool: Pool | undefined;
export function getDb(): Database {
  if (instance) return instance;
  if (!env.DATABASE_URL) throw new AppError(503, 'The service has not been configured yet');
  pool = new Pool({
    connectionString: env.DATABASE_URL,
    max: 10,
    statement_timeout: 10000,
    lock_timeout: 5000,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
    ssl: env.DATABASE_SSL ? { rejectUnauthorized: true } : undefined,
  });
  instance = drizzle(pool, { schema });
  return instance;
}
export function setTestDb(db: Database) {
  if (env.APP_ENV !== 'test') throw new Error('Test database injection is forbidden');
  instance = db;
}
export async function closeDb() {
  await pool?.end();
}

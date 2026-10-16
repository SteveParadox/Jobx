import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { drizzle } from 'drizzle-orm/pglite';
import { readFile } from 'node:fs/promises';
import { setTestDb, type Database } from '../src/db';
import * as schema from '../src/db/schema';
export async function testDatabase(postgresUrl?: string) {
  if (postgresUrl) {
    const { testPostgresDatabase } = await import('./postgres');
    return testPostgresDatabase(postgresUrl);
  }
  const client = new PGlite({ extensions: { pg_trgm } });
  const journal = JSON.parse(await readFile('drizzle/meta/_journal.json', 'utf8'));
  for (const item of journal.entries)
    await client.exec(await readFile(`drizzle/${item.tag}.sql`, 'utf8'));
  const db = drizzle(client, { schema });
  setTestDb(db as unknown as Database);
  return { client, db: db as unknown as Database };
}
export const description =
  '<p>Build reliable software for a real product team. Work with colleagues to design, implement, test and maintain services. Explain your decisions and improve systems through practical review.</p>';
export const jobInput = {
  title: 'Backend Engineer',
  descriptionHtml: description,
  locationLabel: 'Lagos, Nigeria',
  country: 'NG',
  city: 'Lagos',
  workplace: 'onsite' as const,
  remoteCountries: [],
  skills: ['TypeScript', 'PostgreSQL'],
  employmentType: 'FULL_TIME' as const,
  applicationMethod: 'native' as const,
};
export const actor = (id: string, role = 'candidate') => ({
  id,
  name: id,
  email: id + '@example.com',
  role,
  emailVerified: true,
  disabled: false,
});

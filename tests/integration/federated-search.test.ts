import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as s from '../../src/db/schema';
import { federatedSearch } from '../../src/domain/federated-search';
import { createEmployer, saveJob, transitionJob, verifyEmployer } from '../../src/domain/jobs';
import { actor, jobInput, testDatabase } from '../helpers';

let ctx: Awaited<ReturnType<typeof testDatabase>>;
const author = actor('multi-source-employer');
const candidate = actor('multi-source-candidate');
const root = actor('multi-source-admin', 'admin');
beforeAll(async () => { ctx = await testDatabase(); });
afterAll(async () => { await ctx.client.close(); });
beforeEach(async () => {
  await ctx.client.exec('TRUNCATE users, employers RESTART IDENTITY CASCADE');
  for (const person of [author, candidate, root]) await ctx.db.insert(s.user).values(person);
});
describe('federated search catalog boundary', () => {
  it('returns only published jobs and does not write searches, sources or applications', async () => {
    const employer = await createEmployer(author, {
      name: 'Verified fixture company', website: 'https://example.com',
    });
    await verifyEmployer(root, employer.id, 'verified', 'Test employer identity review');
    const pending = await saveJob(author, employer.id, {
      ...jobInput, title: 'Draft QA Specialist',
    });
    const published = await saveJob(author, employer.id, {
      ...jobInput, title: 'Backend Engineer',
    });
    await transitionJob(author, published.id, 'submit');
    await transitionJob(root, published.id, 'publish');
    const result = await federatedSearch({ q: 'Backend Engineer', provider: 'jobx' });
    expect(result.providers).toHaveLength(1);
    expect(result.providers[0].state).toBe('ok');
    expect(result.items.some((j) => j.id === 'jobx:' + published.id)).toBe(true);
    expect(result.items.some((j) => j.id === 'jobx:' + pending.id)).toBe(false);
    expect(await ctx.db.select().from(s.searchHistory)).toHaveLength(0);
    expect(await ctx.db.select().from(s.sources)).toHaveLength(0);
    expect(await ctx.db.select().from(s.applications)).toHaveLength(0);
  });
  it('does not add any nationality or profession preference implicitly', async () => {
    const result = await federatedSearch({ q: 'warehouse', provider: 'jobx' });
    expect(result.query).toMatchObject({
      q: 'warehouse', provider: 'jobx', remoteOnly: 'false',
    });
    expect(result.query.country).toBeUndefined();
    expect(result.query.market).toBeUndefined();
  });
});

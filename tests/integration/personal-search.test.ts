import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as s from '../../src/db/schema';
import { personalJobSearch } from '../../src/domain/personal-search';
import { createEmployer, saveJob, transitionJob, verifyEmployer } from '../../src/domain/jobs';
import { actor, jobInput, testDatabase } from '../helpers';

let ctx: Awaited<ReturnType<typeof testDatabase>>;
const user = actor('personal-candidate');
const other = actor('other-personal-candidate');
const owner = actor('personal-employer');
const admin = actor('personal-admin', 'admin');
beforeAll(async () => { ctx = await testDatabase(); });
afterAll(async () => { await ctx.client.close(); });
beforeEach(async () => {
  await ctx.client.exec('TRUNCATE users, employers RESTART IDENTITY CASCADE');
  for (const person of [user, other, owner, admin]) await ctx.db.insert(s.user).values(person);
});
async function publishRemote(title: string, remoteEligibility: 'restricted' | 'worldwide' | 'unknown', countries: string[]) {
  const employer = await createEmployer(owner, {
    name: 'Personal test employer ' + title,
    website: 'https://example.com',
  });
  await verifyEmployer(admin, employer.id, 'verified', 'Fixture identity evidence for personal search.');
  const job = await saveJob(owner, employer.id, {
    ...jobInput,
    title,
    country: null,
    city: undefined,
    workplace: 'remote',
    locationLabel: 'Remote',
    remoteEligibility,
    remoteCountries: countries,
  });
  await transitionJob(owner, job.id, 'submit');
  await transitionJob(admin, job.id, 'publish');
  return job;
}
describe('private personal search against published job inventory', () => {
  it('filters an explicitly excluded remote country and isolates profiles', async () => {
    await ctx.db.insert(s.profiles).values([
      { userId: user.id, country: 'NG', skills: ['TypeScript'] },
      { userId: other.id, country: 'US', skills: ['TypeScript'] },
    ]);
    const excluded = await publishRemote('TypeScript platform engineer', 'restricted', ['US']);
    const worldwide = await publishRemote('TypeScript remote engineer', 'worldwide', []);

    const forNigeria = await personalJobSearch(user, { remoteOnly: 'true', includeUnconfirmed: 'false' });
    const forUs = await personalJobSearch(other, { remoteOnly: 'true', includeUnconfirmed: 'false' });

    expect(forNigeria.jobs.some((job) => job.id === worldwide.id)).toBe(true);
    expect(forNigeria.jobs.some((job) => job.id === excluded.id)).toBe(false);
    expect(forUs.jobs.some((job) => job.id === excluded.id)).toBe(true);
    expect(forNigeria.profileCountry).toBe('NG');
    expect(forUs.profileCountry).toBe('US');
  });
  it('lets the candidate opt into unknown geography without claiming eligibility', async () => {
    await ctx.db.insert(s.profiles).values({ userId: user.id, country: 'NG', skills: ['TypeScript'] });
    const unknown = await publishRemote('TypeScript cloud developer', 'unknown', []);
    const strict = await personalJobSearch(user, { includeUnconfirmed: 'false' });
    const exploratory = await personalJobSearch(user, { includeUnconfirmed: 'true' });
    expect(strict.jobs.some((job) => job.id === unknown.id)).toBe(false);
    expect(exploratory.jobs.find((job) => job.id === unknown.id)?.geographyStatus).toBe('needs_review');
  });
  it('never creates search history or imports a source during a personal search', async () => {
    await ctx.db.insert(s.profiles).values({ userId: user.id, country: 'NG', skills: ['TypeScript'] });
    await personalJobSearch(user, {});
    expect(await ctx.db.select().from(s.searchHistory)).toHaveLength(0);
    expect(await ctx.db.select().from(s.sources)).toHaveLength(0);
  });
});

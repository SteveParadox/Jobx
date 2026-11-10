import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as s from '../../src/db/schema';
import { reviewExternalDiscoveryLead } from '../../src/domain/discovery/provider-discovery';
import { actor, testDatabase } from '../helpers';

let ctx: Awaited<ReturnType<typeof testDatabase>>;
const root = actor('external-review-admin', 'admin');
const candidate = actor('external-review-candidate');
const leadKey = 'a'.repeat(64);
beforeAll(async () => { ctx = await testDatabase(); });
afterAll(async () => { await ctx.client.close(); });
beforeEach(async () => {
  await ctx.client.exec('TRUNCATE users, employers RESTART IDENTITY CASCADE');
  await ctx.db.insert(s.user).values([root, candidate]);
  await ctx.db.insert(s.externalDiscoveryLeads).values({
    leadKey, provider: 'usajobs', title: 'Administrative Assistant',
    company: 'Agency', location: 'Ohio', url: 'https://www.usajobs.gov/job/100',
    searchQuery: 'administrative assistant',
    contentFingerprint: 'b'.repeat(64),
  });
});
describe('private external discovery review', () => {
  it('requires an administrator and never publishes a job', async () => {
    await expect(reviewExternalDiscoveryLead(
      candidate, leadKey, 'reviewed', 'Candidate cannot approve source.',
    )).rejects.toThrow();
    const result = await reviewExternalDiscoveryLead(
      root, leadKey, 'reviewed', 'Verified source result; awaiting independent source permission.',
    );
    expect(result.state).toBe('reviewed');
    expect((await ctx.db.select().from(s.externalDiscoveryLeads))[0].state).toBe('reviewed');
    expect(await ctx.db.select().from(s.jobs)).toHaveLength(0);
    expect(await ctx.db.select().from(s.sources)).toHaveLength(0);
  });
  it('rejects fabricated identities and leaves the original lead untouched', async () => {
    await expect(reviewExternalDiscoveryLead(
      root, 'not-a-hash', 'rejected', 'No verifiable source ownership.',
    )).rejects.toMatchObject({ status: 400 });
    expect((await ctx.db.select().from(s.externalDiscoveryLeads))[0].state).toBe('pending');
  });
});

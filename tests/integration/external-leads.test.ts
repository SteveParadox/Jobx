import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { env } from '../../src/lib/config';
import * as s from '../../src/db/schema';
import { listSavedExternalLeads, pruneDisallowedExternalLeads, removeExternalLead, saveExternalLead, updateExternalLead } from '../../src/domain/external-leads';
import { sealExternalLead } from '../../src/domain/external-lead-tokens';
import { recommendations, updateCandidatePreferences, exportCandidateData } from '../../src/domain/candidates';
import type { SearchLead } from '../../src/integrations/federated-providers';
import { actor, testDatabase } from '../helpers';

let ctx: Awaited<ReturnType<typeof testDatabase>>;
const first = actor('watchlist-first');
const second = actor('watchlist-second');
const previousProviders = env.JOB_EXTERNAL_SAVE_PROVIDERS;
const previousSecret = env.AUTH_SECRET;
const lead: SearchLead = {
  id: 'usajobs:one', provider: 'usajobs', providerName: 'USAJOBS',
  title: 'Human Resources Officer', company: 'Government',
  location: 'New York', url: 'https://www.usajobs.gov/job/100',
  excerpt: '', postedAt: null, provenance: 'external_api',
  attributionUrl: 'https://www.usajobs.gov', attributionLogoUrl: null,
};
beforeAll(async () => { ctx = await testDatabase(); });
afterAll(async () => {
  env.JOB_EXTERNAL_SAVE_PROVIDERS = previousProviders;
  env.AUTH_SECRET = previousSecret;
  await ctx.client.close();
});
beforeEach(async () => {
  await ctx.client.exec('TRUNCATE users, employers RESTART IDENTITY CASCADE');
  for (const user of [first, second]) await ctx.db.insert(s.user).values(user);
  env.AUTH_SECRET = 'integration-test-secret-at-least-32-characters';
  env.JOB_EXTERNAL_SAVE_PROVIDERS = 'usajobs';
});
describe('external leads and explicit personalization', () => {
  it('keeps leads private, self-tracked and deduplicated', async () => {
    const token = sealExternalLead(lead, first.id)!;
    await saveExternalLead(first, token);
    await saveExternalLead(first, token);
    const rows = await listSavedExternalLeads(first);
    expect(rows).toHaveLength(1);
    expect(await listSavedExternalLeads(second)).toHaveLength(0);
    await expect(updateExternalLead(second, rows[0].id, 'applied')).rejects.toMatchObject({ status: 404 });
    await updateExternalLead(first, rows[0].id, 'applied');
    expect((await listSavedExternalLeads(first))[0].status).toBe('applied');
    expect((await exportCandidateData(first)).externalLeads).toHaveLength(1);
    await removeExternalLead(first, rows[0].id);
    expect(await listSavedExternalLeads(first)).toHaveLength(0);
  });
  it('deletes private copies after a provider is disabled', async () => {
    await saveExternalLead(first, sealExternalLead(lead, first.id)!);
    env.JOB_EXTERNAL_SAVE_PROVIDERS = '';
    await pruneDisallowedExternalLeads();
    expect(await ctx.db.select().from(s.externalSavedLeads)).toHaveLength(0);
  });
  it('keeps matching disabled until consent and does not store implicit search history', async () => {
    const before = await recommendations(first);
    expect(before.jobs).toHaveLength(0);
    expect(before.explanation).toContain('Enable optional');
    await updateCandidatePreferences(first, {
      emailAlertsEnabled: true,
      searchHistoryEnabled: false,
      personalizationEnabled: true,
    });
    const prefs = await ctx.db.select().from(s.candidatePreferences)
      .where(eq(s.candidatePreferences.userId, first.id));
    expect(prefs[0].personalizationEnabled).toBe(true);
    expect(await ctx.db.select().from(s.searchHistory)).toHaveLength(0);
  });
});

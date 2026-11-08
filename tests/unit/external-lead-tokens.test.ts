import { afterEach, describe, expect, it } from 'vitest';
import { env } from '../../src/lib/config';
import { sealExternalLead, unsealExternalLead, providerStorageAllowed } from '../../src/domain/external-lead-tokens';
import type { SearchLead } from '../../src/integrations/federated-providers';

const oldKey = env.AUTH_SECRET;
const oldProviders = env.JOB_EXTERNAL_SAVE_PROVIDERS;
afterEach(() => {
  env.AUTH_SECRET = oldKey;
  env.JOB_EXTERNAL_SAVE_PROVIDERS = oldProviders;
});
const example: SearchLead = {
  id: 'usajobs:123', provider: 'usajobs', providerName: 'USAJOBS',
  title: 'Public Health Specialist', company: 'Agency', location: 'Washington',
  url: 'https://www.usajobs.gov/job/123', excerpt: '', postedAt: null,
  provenance: 'external_api', attributionUrl: 'https://www.usajobs.gov',
  attributionLogoUrl: null,
};
describe('licensed saved-lead tokens', () => {
  it('requires explicit provider retention permission', () => {
    env.AUTH_SECRET = 'unit-test-secret-at-least-32-characters-long';
    env.JOB_EXTERNAL_SAVE_PROVIDERS = '';
    expect(sealExternalLead(example, 'account1')).toBeNull();
    expect(providerStorageAllowed('adzuna')).toBe(false);
    expect(providerStorageAllowed('himalayas')).toBe(false);
  });
  it('is bound to one user, tamper-resistant and expires', () => {
    env.AUTH_SECRET = 'unit-test-secret-at-least-32-characters-long';
    env.JOB_EXTERNAL_SAVE_PROVIDERS = 'usajobs';
    const now = 1_800_000_000_000;
    const token = sealExternalLead(example, 'account1', now);
    expect(token).toBeTruthy();
    expect(unsealExternalLead(token!, 'account1', now).title).toBe(example.title);
    expect(() => unsealExternalLead(token!, 'account2', now)).toThrow();
    expect(() => unsealExternalLead(token!.slice(0,-2)+'ab', 'account1', now)).toThrow();
    expect(() => unsealExternalLead(token!, 'account1', now + 16 * 60_000)).toThrow();
    env.JOB_EXTERNAL_SAVE_PROVIDERS = '';
    expect(() => unsealExternalLead(token!, 'account1', now)).toThrow();
  });
});

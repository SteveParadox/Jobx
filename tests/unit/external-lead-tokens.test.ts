import { describe, expect, it, afterEach } from 'vitest';
import { env } from '../../src/lib/config';
import { sealExternalLead, unsealExternalLead, providerStorageAllowed } from '../../src/domain/external-lead-tokens';
import type { SearchLead } from '../../src/integrations/federated-providers';

const beforeSecret = env.AUTH_SECRET;
const beforeAllowed = env.JOB_EXTERNAL_SAVE_PROVIDERS;
afterEach(() => {
  env.AUTH_SECRET = beforeSecret;
  env.JOB_EXTERNAL_SAVE_PROVIDERS = beforeAllowed;
});
const example: SearchLead = {
  id: 'usajobs:example', provider: 'usajobs', providerName: 'USAJOBS',
  title: 'Public Health Analyst', company: 'Agency',
  location: 'Washington', url: 'https://www.usajobs.gov/job/100',
  excerpt: '', postedAt: null, provenance: 'external_api',
  attributionUrl: 'https://www.usajobs.gov', attributionLogoUrl: null,
};
describe('signed candidate-lead bookmarks', () => {
  it('defaults to no provider retention, including Adzuna/Himalayas', () => {
    env.AUTH_SECRET = 'unit-test-secret-that-is-at-least-32-characters';
    env.JOB_EXTERNAL_SAVE_PROVIDERS = '';
    expect(sealExternalLead(example, 'user1')).toBeNull();
    expect(providerStorageAllowed('adzuna')).toBe(false);
    expect(providerStorageAllowed('himalayas')).toBe(false);
  });
  it('rejects replay across users, tampering, expired tokens and permission withdrawal', () => {
    env.AUTH_SECRET = 'unit-test-secret-that-is-at-least-32-characters';
    env.JOB_EXTERNAL_SAVE_PROVIDERS = 'usajobs';
    const now = 1800000000000;
    const token = sealExternalLead(example, 'user1', now);
    expect(token).toBeTruthy();
    expect(unsealExternalLead(token!, 'user1', now).title).toBe(example.title);
    expect(() => unsealExternalLead(token!, 'user2', now)).toThrow();
    expect(() => unsealExternalLead(token! + 'a', 'user1', now)).toThrow();
    expect(() => unsealExternalLead(token!, 'user1', now + 16 * 60000)).toThrow();
    env.JOB_EXTERNAL_SAVE_PROVIDERS = '';
    expect(() => unsealExternalLead(token!, 'user1', now)).toThrow();
  });
  it('does not make a very long upstream URL break the whole search', () => {
    env.AUTH_SECRET = 'unit-test-secret-that-is-at-least-32-characters';
    env.JOB_EXTERNAL_SAVE_PROVIDERS = 'usajobs';
    expect(sealExternalLead({ ...example, url: 'https://www.usajobs.gov/' + 'x'.repeat(2400) }, 'user1'))
      .toBeNull();
  });
});

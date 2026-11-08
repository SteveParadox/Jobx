import { describe, expect, it } from 'vitest';
import {
  configuredProviderDiscoverySeeds, discoveryLeadFingerprint,
} from '../../src/domain/discovery/provider-discovery';

describe('bounded autonomous API discovery seeds', () => {
  it('keeps operator-selected regions, occupations and location intact', () => {
    expect(configuredProviderDiscoverySeeds(JSON.stringify([
      { q: 'factory electrician', provider: 'jooble', location: 'Lagos', market: 'ng' },
      { q: 'research assistant', provider: 'usajobs', location: 'Boston', market: 'us' },
    ]))).toHaveLength(2);
  });
  it('rejects unlicensed or arbitrary provider types, huge seed lists and malformed JSON', () => {
    expect(() => configuredProviderDiscoverySeeds('[{"q":"x","provider":"jooble"}]')).toThrow();
    expect(() => configuredProviderDiscoverySeeds(JSON.stringify([
      { q: 'any jobs', provider: 'private_site', location: 'Anywhere' },
    ]))).toThrow();
    expect(() => configuredProviderDiscoverySeeds(JSON.stringify(
      Array.from({ length: 11 }, () => ({ q: 'any jobs', provider: 'usajobs' })),
    ))).toThrow();
    expect(() => configuredProviderDiscoverySeeds('{oops')).toThrow();
  });
  it('deduplicates identities but detects genuine content changes', () => {
    const a = { provider: 'jooble', url: 'https://jooble.org/jdp/1',
      title: 'Chef', company: 'Cafe', location: 'Accra', excerpt: 'Work in a kitchen.' };
    const b = { ...a, title: 'Head Chef' };
    const aa = discoveryLeadFingerprint(a), bb = discoveryLeadFingerprint(b);
    expect(aa.key).toBe(bb.key);
    expect(aa.content).not.toBe(bb.content);
  });
});

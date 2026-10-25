import { describe, expect, it } from 'vitest';
import { runConfiguredSeedDiscovery } from '../../src/domain/discovery/discovery-service';
import { requestWithRetry } from '../../src/domain/discovery/career-crawler';
import {
  candidateFromUrl,
  canonicalizeCandidateUrl,
  detectAts,
  mergeCandidateEvidence,
  resolveSameHostLink,
} from '../../src/domain/discovery/source-classifier';

describe('permission-aware source discovery primitives', () => {
  it('rejects oversized seed lists instead of silently truncating them', async () => {
    const seeds = Array.from({ length: 26 }, (_, index) => `https://example-${index}.com`).join('\n');
    await expect(runConfiguredSeedDiscovery(seeds, 60)).resolves.toMatchObject({
      skipped: true,
      reason: 'seed_limit_exceeded',
      seedsSeen: 26,
      maxSeeds: 25,
    });
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, 15.5])(
    'rejects invalid discovery intervals before accessing the database (%s)',
    async (interval) => {
      await expect(runConfiguredSeedDiscovery('https://example.com', interval)).resolves.toMatchObject({
        skipped: true,
        reason: 'invalid_discovery_interval',
      });
    },
  );

  it.each([
    ['https://boards.greenhouse.io/acme', 'greenhouse', 'acme'],
    ['https://jobs.lever.co/acme', 'lever', 'acme'],
    ['https://jobs.eu.lever.co/acme', 'lever_eu', 'acme'],
    ['https://jobs.ashbyhq.com/acme', 'ashby', 'acme'],
  ] as const)('detects %s', (url, provider, boardToken) => {
    expect(detectAts(url)).toEqual({ provider, boardToken });
  });

  it('does not classify lookalike or malformed ATS hosts', () => {
    expect(detectAts('https://boards.greenhouse.io.attacker.example/acme')).toBeNull();
    expect(detectAts('http://jobs.lever.co/acme')).toBeNull();
    expect(detectAts('https://jobs.ashbyhq.com/')).toBeNull();
  });

  it('canonicalizes tracking parameters without changing the host', () => {
    expect(canonicalizeCandidateUrl('https://jobs.lever.co/acme/?utm_source=test&b=2#a'))
      .toBe('https://jobs.lever.co/acme?b=2');
  });

  it.each([
    'http://example.com/jobs',
    'https://localhost/jobs',
    'https://127.0.0.1/jobs',
    'https://user:pass@example.com/jobs',
    'https://example.com:8443/jobs',
  ])('rejects unsafe candidate URL %s', (url) => {
    expect(() => canonicalizeCandidateUrl(url)).toThrow();
  });

  it('always requires permission review even for a recognized ATS board', () => {
    const candidate = candidateFromUrl('https://jobs.ashbyhq.com/example', 'seed_domain', '2026-01-01T00:00:00.000Z');
    expect(candidate.provider).toBe('ashby');
    expect(candidate.state).toBe('REVIEW_REQUIRED');
    expect(candidate.requiresPermissionReview).toBe(true);
  });

  it('resolves same-host links and rejects external links', () => {
    expect(resolveSameHostLink('https://example.com/careers', '/jobs/1'))
      .toBe('https://example.com/jobs/1');
    expect(resolveSameHostLink('https://example.com/careers', 'https://attacker.example/jobs')).toBeNull();
    expect(resolveSameHostLink('https://example.com/careers', 'http://example.com/jobs')).toBeNull();
  });

  it('merges evidence idempotently and refuses mismatched identities', () => {
    const a = candidateFromUrl('https://boards.greenhouse.io/acme', 'career_link', '2026-01-01T00:00:00.000Z');
    const b = candidateFromUrl('https://boards.greenhouse.io/acme', 'seed_domain', '2026-01-02T00:00:00.000Z');
    expect(mergeCandidateEvidence(a, a).evidence).toHaveLength(1);
    expect(mergeCandidateEvidence(a, b).evidence).toHaveLength(2);
    expect(() => mergeCandidateEvidence(a, candidateFromUrl('https://jobs.lever.co/acme'))).toThrow();
  });
  it('retries transient HTTP failures and succeeds within the attempt limit', async () => {
    let calls = 0;
    const result = await requestWithRetry(
      new URL('https://careers.example.com/robots.txt'),
      async (url) => {
        calls++;
        return {
          url,
          status: calls === 1 ? 503 : 200,
          headers: {},
          body: '',
        };
      },
      async () => {},
    );

    expect(calls).toBe(2);
    expect(result.status).toBe(200);
  });

  it('does not retry a public-address validation failure', async () => {
    let calls = 0;
    const failure = new Error('DNS resolved to an address outside the public unicast range');

    await expect(
      requestWithRetry(
        new URL('https://localhost/robots.txt'),
        async () => {
          calls++;
          throw failure;
        },
        async () => {},
      ),
    ).rejects.toBe(failure);

    expect(calls).toBe(1);
  });

});

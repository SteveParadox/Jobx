import { describe, expect, it } from 'vitest';
import {
  candidateFromUrl,
  canonicalizeCandidateUrl,
  detectAts,
  mergeCandidateEvidence,
  resolveSameHostLink,
} from '../../src/domain/discovery/source-classifier';

describe('permission-aware source discovery primitives', () => {
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
});

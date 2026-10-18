import { lookup } from 'node:dns/promises';
import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { ingestionBackoff } from '../../src/domain/ingestion-tasks';
import { normalizeAshby, sourceAdapter } from '../../src/integrations/sources/adapters';
import {
  sourceConfigSchema,
  type Source as RegisteredSource,
} from '../../src/integrations/sources/contracts';
import type { Transport } from '../../src/integrations/sources/http';
import {
  approvedUrl,
  createSourceContext,
  isPublicAddress,
  resolvePublicAddresses,
  retryAfter,
} from '../../src/integrations/sources/http';
import {
  canonicalApplicationUrl,
  normalizedRecord,
  readPath,
  validateSnapshot,
} from '../../src/integrations/sources/normalize';
import { description } from '../helpers';
const fixture = (ext: string) => readFile(`tests/fixtures/ingestion/jobs.${ext}`, 'utf8');
function context(
  provider = 'authorized_json',
  body = '{}',
  config: Record<string, unknown> = {},
  transport?: Transport,
) {
  const source = {
    provider,
    boardToken: 'fixture',
    endpointUrl: 'https://careers.example.com/jobs',
    approvedHostname: 'careers.example.com',
    applicationHostnames: ['careers.example.com'],
    config: { robots: false, ...config },
  } as RegisteredSource;
  return createSourceContext(source, {
    transport:
      transport ??
      (async (url) => ({
        url,
        status: 200,
        headers: new Headers({
          'content-type':
            provider === 'authorized_html'
              ? 'text/html'
              : provider.includes('xml') || provider.includes('rss')
                ? 'application/xml'
                : 'application/json',
        }),
        body,
      })),
  });
}
describe('source HTTP boundaries', () => {
  it.each([
    '127.0.0.1',
    '10.1.1.1',
    '169.254.169.254',
    '172.16.2.1',
    '192.168.1.2',
    '0.0.0.0',
    '100.64.1.2',
    '224.0.0.1',
    '::1',
    'fe80::1',
    'fc00::1',
    '::ffff:127.0.0.1',
    '2001:db8::1',
  ])('rejects private/special address %s', (address) =>
    expect(isPublicAddress(address)).toBe(false),
  );
  it('accepts public unicast and rejects mixed DNS answers', async () => {
    expect(isPublicAddress('93.184.216.34')).toBe(true);
    const resolver = vi.fn(async () => [
      { address: '93.184.216.34', family: 4 },
      { address: '127.0.0.1', family: 4 },
    ]) as unknown as typeof lookup;
    await expect(resolvePublicAddresses('careers.example.com', resolver)).rejects.toMatchObject({
      code: 'UNSAFE_DNS',
    });
    expect(() => approvedUrl('https://evil.example.com/jobs', 'careers.example.com')).toThrow();
    expect(() =>
      approvedUrl('https://careers.example.com.evil.com/jobs', 'careers.example.com'),
    ).toThrow();
  });
  it('blocks unsafe redirects before contacting the target host', async () => {
    const transport = vi.fn(async (url: string) => ({
      url,
      status: 302,
      body: '',
      headers: new Headers({ location: 'https://127.0.0.1/private' }),
    }));
    await expect(
      context('authorized_json', '', {}, transport).request('https://careers.example.com/jobs', [
        'application/json',
      ]),
    ).rejects.toThrow();
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it('follows bounded same-host redirects through the same guard', async () => {
    const transport = vi.fn(async (url: string) => ({
      url,
      status: url.endsWith('/jobs') ? 301 : 200,
      body: '{}',
      headers: new Headers({ location: '/current', 'content-type': 'application/json' }),
    }));
    expect(
      (
        await context('authorized_json', '', {}, transport).request(
          'https://careers.example.com/jobs',
          ['application/json'],
        )
      ).url,
    ).toBe('https://careers.example.com/current');
    expect(transport).toHaveBeenCalledTimes(2);
  });
  it('honors robots denial without fetching the catalog', async () => {
    const transport = vi.fn(async (url: string) => ({
      url,
      status: 200,
      body: 'User-agent: CareerAtlasBot\nDisallow: /jobs',
      headers: new Headers({ 'content-type': 'text/plain' }),
    }));
    await expect(
      context('authorized_json', '', { robots: true }, transport).request(
        'https://careers.example.com/jobs',
        ['application/json'],
      ),
    ).rejects.toMatchObject({ code: 'ROBOTS_DENIED' });
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it('records 429 backoff and rejects wrong types, oversized bodies and exhausted request budgets', async () => {
    const limited: Transport = async (url) => ({
      url,
      status: 429,
      body: '',
      headers: new Headers({ 'retry-after': '120' }),
    });
    await expect(
      context('authorized_json', '', {}, limited).request('https://careers.example.com/jobs', [
        'application/json',
      ]),
    ).rejects.toMatchObject({ code: 'RATE_LIMIT', retryAfterMs: 120000 });
    await expect(
      context('authorized_html', '<html/>').request('https://careers.example.com/jobs', [
        'application/json',
      ]),
    ).rejects.toMatchObject({ code: 'CONTENT_TYPE' });
    await expect(
      context('authorized_json', 'x'.repeat(1001), { maxBytes: 1000 }).request(
        'https://careers.example.com/jobs',
        ['application/json'],
      ),
    ).rejects.toMatchObject({ code: 'RESPONSE_LIMIT' });
    const ctx = context('authorized_json', '{}', { maxRequests: 1 });
    await ctx.request('https://careers.example.com/jobs', ['application/json']);
    await expect(
      ctx.request('https://careers.example.com/jobs', ['application/json']),
    ).rejects.toMatchObject({ code: 'REQUEST_LIMIT' });
  });
  it('enforces timeouts even when a transport ignores cancellation', async () => {
    const ctx = context(
      'authorized_json',
      '',
      { timeoutMs: 1000 },
      async () => new Promise(() => {}),
    );
    await expect(
      ctx.request('https://careers.example.com/jobs', ['application/json']),
    ).rejects.toMatchObject({ retryable: true });
  });
  it('bounds retry delays and uses jitter', () => {
    expect(ingestionBackoff(1, () => 0)).toBe(22500);
    expect(ingestionBackoff(1, () => 1)).toBe(37500);
    expect(retryAfter('120')).toBe(120000);
    expect(retryAfter('999999')).toBe(86400000);
  });
});
describe('authorized source adapters', () => {
  it('normalizes explicit ISO codes and XML scalar values without guessing remote eligibility', () => {
    const row = normalizedRecord({
      externalId: 'iso-fixture',
      title: 'Fixture Engineer',
      sourceUrl: 'https://careers.example.com/iso',
      applyUrl: 'https://careers.example.com/iso/apply',
      descriptionHtml: description,
      country: 'USA',
      salaryMin: '50000',
      currency: 'USD',
      salaryPeriod: 'YEAR',
      skills: 'TypeScript;PostgreSQL',
      qualifications: ['An explicit fixture qualification'],
      workplace: 'onsite',
      locationLabel: 'Explicit source location',
    });
    expect(row.data.country).toBe('US');
    expect(row.data.salaryMin).toBe(50000);
    expect(row.data.skills).toEqual(['TypeScript', 'PostgreSQL']);
    expect(row.data.remoteCountries).toEqual([]);
    expect(row.data.descriptionHtml).toContain('<h3>Qualifications</h3>');
    expect(row.data.descriptionHtml).toContain('An explicit fixture qualification');
    expect(() =>
      sourceConfigSchema.parse({ fieldMap: JSON.parse('{"__proto__":"value"}') }),
    ).toThrow();
  });
  it.each([
    ['authorized_json', 'json', {}],
    ['authorized_xml', 'xml', { recordsPath: 'jobs.job' }],
    ['authorized_rss', 'rss', {}],
    ['authorized_html', 'html', {}],
  ])(
    'parses recorded %s fixtures without fabricating missing claims',
    async (provider, ext, config) => {
      const ctx = context(provider, await fixture(ext), config);
      const snapshot = validateSnapshot(await sourceAdapter(provider).fetch(ctx), ctx);
      expect(snapshot.records).toHaveLength(1);
      expect(snapshot.records[0].data.descriptionHtml).not.toContain('<script');
      expect(snapshot.records[0].data.salaryMin).toBeUndefined();
      if (provider === 'authorized_rss' || provider === 'authorized_html')
        expect(snapshot.records[0].data.country).toBeUndefined();
      if (provider === 'authorized_rss') expect(snapshot.complete).toBe(false);
    },
  );
  it('handles pagination and refuses page cycles and partial envelopes', async () => {
    const row = JSON.parse(await fixture('json')).jobs[0];
    const pages: Transport = async (url) => ({
      url,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        jobs: [{ ...row, externalId: url.endsWith('two') ? 'two' : 'one' }],
        next: url.endsWith('two') ? null : '/two',
      }),
    });
    const ctx = context('authorized_json', '', { nextPath: 'next' }, pages);
    expect((await sourceAdapter('authorized_json').fetch(ctx)).records).toHaveLength(2);
    const partial = context('authorized_json', JSON.stringify({ jobs: [row], hasMore: true }));
    await expect(sourceAdapter('authorized_json').fetch(partial)).rejects.toMatchObject({
      code: 'PARTIAL_FEED',
    });
    const cycle = context('authorized_json', JSON.stringify({ jobs: [row], next: '/jobs' }), {
      nextPath: 'next',
    });
    await expect(sourceAdapter('authorized_json').fetch(cycle)).rejects.toMatchObject({
      code: 'REPEATED_PAGE',
    });
  });
  it('quarantines invalid rows and duplicate IDs without treating a partial result as complete', async () => {
    const row = JSON.parse(await fixture('json')).jobs[0];
    const ctx = context(
      'authorized_json',
      JSON.stringify({ jobs: [row, row, { externalId: 'bad', title: 'Bad' }] }),
    );
    const snapshot = validateSnapshot(await sourceAdapter('authorized_json').fetch(ctx), ctx);
    expect(snapshot.records).toHaveLength(1);
    expect(snapshot.complete).toBe(false);
    expect(snapshot.rejected).toHaveLength(2);
  });
  it('requires an explicit empty feed contract and recognizable HTML empty state', async () => {
    await expect(
      sourceAdapter('authorized_json').fetch(context('authorized_json', '{"jobs":[]}')),
    ).rejects.toMatchObject({ code: 'EMPTY_UNCONFIRMED' });
    expect(
      (
        await sourceAdapter('authorized_json').fetch(
          context('authorized_json', '{"jobs":[]}', { emptyMeansComplete: true }),
        )
      ).complete,
    ).toBe(true);
    await expect(
      sourceAdapter('authorized_html').fetch(
        context('authorized_html', '<html><p>Access denied</p></html>'),
      ),
    ).rejects.toMatchObject({ code: 'HTML_SHAPE' });
    expect(
      (
        await sourceAdapter('authorized_html').fetch(
          context('authorized_html', '<p class="empty">No jobs</p>', { emptySelector: '.empty' }),
        )
      ).records,
    ).toHaveLength(0);
  });
  it('rejects XML entity declarations, source robots metadata and unapproved application hosts', async () => {
    await expect(
      sourceAdapter('authorized_xml').fetch(context('authorized_xml', '<!DOCTYPE x><jobs/>')),
    ).rejects.toMatchObject({ code: 'MALFORMED_XML' });
    await expect(
      sourceAdapter('authorized_html').fetch(
        context(
          'authorized_html',
          '<meta name="robots" content="noindex">' + (await fixture('html')),
        ),
      ),
    ).rejects.toMatchObject({ code: 'PAGE_ROBOTS' });
    const row = JSON.parse(await fixture('json')).jobs[0];
    row.applyUrl = 'https://unapproved.example.com/apply';
    const ctx = context('authorized_json', JSON.stringify({ jobs: [row] }));
    expect(
      validateSnapshot(await sourceAdapter('authorized_json').fetch(ctx), ctx).rejected[0].reason,
    ).toContain('APPLICATION_HOST');
  });
  it('normalizes documented Ashby fields without mistaking last publication for original date', () => {
    const job = normalizeAshby({
      title: 'Fixture Ashby Engineer',
      jobUrl: 'https://careers.example.com/ashby',
      applyUrl: 'https://careers.example.com/ashby/apply',
      descriptionHtml: description,
      isListed: true,
      workplaceType: 'Hybrid',
      employmentType: 'FullTime',
      publishedAt: '2025-01-15T00:00:00Z',
      address: { postalAddress: { addressCountry: 'NG', addressLocality: 'Lagos' } },
      compensation: {
        summaryComponents: [
          {
            compensationType: 'Salary',
            currencyCode: 'NGN',
            interval: '1 YEAR',
            minValue: 1000000,
            maxValue: 2000000,
          },
        ],
      },
    })!;
    expect(job.data).toMatchObject({
      country: 'NG',
      workplace: 'hybrid',
      salaryMin: 1000000,
      salaryPeriod: 'YEAR',
      employmentType: 'FULL_TIME',
    });
    expect(job.data.originalPostedAt).toBeUndefined();
    expect(job.sourcePostedAt).toBe('2025-01-15T00:00:00.000Z');
    expect(
      normalizeAshby({
        title: 'Hidden',
        jobUrl: 'https://careers.example.com/a',
        applyUrl: 'https://careers.example.com/a',
        descriptionHtml: description,
        isListed: false,
      }),
    ).toBeNull();
  });
  it('uses only exact approved Greenhouse location overrides to enable publication-quality locations', async () => {
    const payload = JSON.stringify({ jobs: [
      { id: 42, title: 'Backend Engineer', absolute_url: 'https://careers.example.com/jobs/42',
        content: description, location: { name: 'Lagos, Nigeria' } },
    ] });
    const unmapped = await sourceAdapter('greenhouse').fetch(context('greenhouse', payload));
    expect(unmapped.records[0].data.workplace).toBe('unknown');
    expect(unmapped.records[0].data.country).toBeUndefined();
    const mapped = await sourceAdapter('greenhouse').fetch(context('greenhouse', payload, {
      locationOverrides: {
        'Lagos, Nigeria': { country: 'NG', city: 'Lagos', workplace: 'onsite' },
      },
    }));
    expect(mapped.records[0].data).toMatchObject({
      country: 'NG', city: 'Lagos', workplace: 'onsite',
    });
    expect(() => sourceConfigSchema.parse({
      locationOverrides: { Anywhere: { workplace: 'remote', remoteCountries: [] } },
    })).toThrow();
  });
  it('guards browser execution and unsafe mapping paths', async () => {
    await expect(
      sourceAdapter('authorized_browser').fetch(context('authorized_browser', '')),
    ).rejects.toMatchObject({ code: 'BROWSER_DISABLED' });
    expect(() => readPath({}, '__proto__.secret')).toThrow();
    expect(
      canonicalApplicationUrl('https://careers.example.com/apply?id=42&utm_source=ad#form'),
    ).toBe('https://careers.example.com/apply?id=42');
    expect(sourceConfigSchema.parse({}).maxRequests).toBe(50);
  });
});

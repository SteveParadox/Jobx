import { describe, expect, it, vi } from 'vitest';
import {
  parseAdzuna,
  parseJooble,
  parseUsaJobs,
  parseHimalayas,
  fetchHimalayas,
  fetchUsaJobs,
  safeProviderUrl,
  uniqueLeads,
} from '../../src/integrations/federated-providers';
import { federatedSearchSchema } from '../../src/domain/federated-search';

describe('federated search input and official API adapters', () => {
  it('rejects empty/long searches and arbitrary provider names', () => {
    expect(federatedSearchSchema.safeParse({ q: '  ' }).success).toBe(false);
    expect(federatedSearchSchema.safeParse({ q: 'software', provider: 'madeup' }).success).toBe(false);
    expect(federatedSearchSchema.safeParse({ q: 'software', country: 'NG', market: 'gb' }).success).toBe(true);
    expect(federatedSearchSchema.safeParse({ q: 'software', country: 'Nigeria' }).success).toBe(false);
  });
  it('accepts only fixed provider HTTPS links and rejects private redirects', () => {
    expect(safeProviderUrl('http://www.usajobs.gov/123', 'usajobs.gov')).toBeNull();
    expect(safeProviderUrl('https://www.usajobs.gov.evil.example/job', 'usajobs.gov')).toBeNull();
    expect(safeProviderUrl('https://127.0.0.1/job', 'usajobs.gov')).toBeNull();
    expect(safeProviderUrl('https://www.usajobs.gov/job?utm_source=test&id=5', 'usajobs.gov'))
      .toBe('https://www.usajobs.gov/job?id=5');
    expect(safeProviderUrl('javascript:alert(1)', 'usajobs.gov')).toBeNull();
  });
  it('parses Adzuna with official display attribution and skips unsafe links', () => {
    const jobs = parseAdzuna({
      results: [
        {
          id: 'a1', title: 'Civil Engineer', company: { display_name: 'Builder Ltd' },
          location: { display_name: 'London' }, redirect_url: 'https://www.adzuna.co.uk/jobs/details/1',
          description: '<b>Build</b> projects', created: '2026-10-01T00:00:00Z',
        },
        { id: 'a2', title: 'Pharmacist', redirect_url: 'https://evil.example/offer' },
      ],
    }, 'gb', '/brand/adzuna.svg');
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      provider: 'adzuna', company: 'Builder Ltd', location: 'London',
      excerpt: 'Build projects', attributionLogoUrl: '/brand/adzuna.svg',
    });
  });
  it('parses USAJOBS without treating open federal jobs as globally eligible', () => {
    const jobs = parseUsaJobs({
      SearchResult: {
        SearchResultItems: [{
          MatchedObjectId: '100', MatchedObjectDescriptor: {
            PositionTitle: 'Administrative Assistant',
            PositionURI: 'https://www.usajobs.gov/job/100',
            OrganizationName: 'Agency', PositionLocationDisplay: 'Washington, DC',
            QualificationSummary: 'Read citizenship requirements before applying.',
          },
        }],
      },
    });
    expect(jobs).toHaveLength(1);
    expect(jobs[0].provenance).toBe('external_api');
    expect(JSON.stringify(jobs[0])).not.toContain('eligible');
  });
  it('parses no-key Himalayas results with epoch timestamps, expiry and source application links', () => {
    const jobs = parseHimalayas({
      jobs: [
        {
          guid: 'test-1', title: 'Remote Teacher', companyName: 'Example Academy',
          excerpt: 'Teach and assess students.',
          applicationLink: 'https://himalayas.app/jobs/remote-teacher',
          pubDate: 1794010000000,
          expiryDate: 4102444800000,
        },
        {
          guid: 'test-expired', title: 'Expired Teacher', companyName: 'Old School',
          applicationLink: 'https://himalayas.app/jobs/expired',
          expiryDate: 978307200000,
        },
        {
          guid: 'test-redirect', title: 'Unsafe Job', companyName: 'Example',
          applicationLink: 'https://unsafe.example/jobs',
        },
      ],
    }, 1794150000000);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      provider: 'himalayas',
      title: 'Remote Teacher',
      company: 'Example Academy',
      url: 'https://himalayas.app/jobs/remote-teacher',
      attributionUrl: 'https://himalayas.app',
    });
    expect(jobs[0].postedAt).toMatch(/^2026-/);
    expect(jobs[0].expiresAt).toBe('2100-01-01T00:00:00.000Z');
  });
  it('calls the keyless Himalayas search endpoint without profile data or credentials', async () => {
    const request = vi.fn(async (_url: string, _init?: RequestInit) =>
      new Response(JSON.stringify({ jobs: [] }), {
        headers: { 'Content-Type': 'application/json' },
      }));
    expect(await fetchHimalayas(
      { q: 'nursing', page: 2, country: 'GB' },
      request as unknown as typeof fetch,
    )).toEqual([]);
    const [requestUrl, init] = request.mock.calls[0];
    expect(requestUrl).toContain('/jobs/api/search');
    expect(requestUrl).toContain('q=nursing');
    expect(requestUrl).toContain('country=GB');
    expect(requestUrl).not.toContain('api_key');
    expect(JSON.stringify(init)).not.toContain('Authorization');
  });
  it('rejects unsafe upstream payloads rather than claiming an empty job market', async () => {
    const request = vi.fn(async () =>
      new Response(JSON.stringify({ error: 'temporary outage' }), {
        headers: { 'Content-Type': 'application/json' },
      }));
    await expect(fetchHimalayas(
      { q: 'teacher', page: 1 }, request as unknown as typeof fetch,
    )).rejects.toThrow('UPSTREAM_ENVELOPE');
  });
  it('parses Jooble as attributed external leads', () => {
    const jobs = parseJooble({
      jobs: [{ id: 88, title: 'HR Specialist', company: 'Acme',
        link: 'https://ng.jooble.org/jdp/88', location: 'Lagos', snippet: 'Human resources.' }],
    });
    expect(jobs).toHaveLength(1);
    expect(jobs[0].providerName).toBe('Jooble');
    expect(jobs[0].provenance).toBe('external_api');
  });
  it('rejects redirects and does not expose a provider API credential in output', async () => {
    const request = vi.fn(async (_url: string, _init?: RequestInit) => new Response(
      JSON.stringify({ SearchResult: { SearchResultItems: [] } }),
      { headers: { 'Content-Type': 'application/json' } },
    ));
    const results = await fetchUsaJobs(
      { q: 'nurse', location: '', page: 1 },
      { apiKey: 'secret-key-for-test', email: 'operator@example.com' },
      false, request as unknown as typeof fetch,
    );
    expect(results).toEqual([]);
    expect(request.mock.calls[0][0]).toMatch(/^https:\/\/data\.usajobs\.gov\/api\/search/);
    expect(JSON.stringify(results)).not.toContain('secret-key-for-test');
  });
  it('preserves first occurrence per exact source link, without inventing fuzzy merges', () => {
    const [original] = parseJooble({
      jobs: [{ id: 1, title: 'Nurse', link: 'https://jooble.org/jdp/1' }],
    });
    expect(uniqueLeads([original, { ...original, id: 'jooble:duplicate' }])).toHaveLength(1);
    expect(uniqueLeads([
      original, { ...original, id: 'jooble:different', url: 'https://jooble.org/jdp/2' },
    ])).toHaveLength(2);
  });
});

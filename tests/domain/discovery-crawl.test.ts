import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { crawlCareerSeed, requestWithRetry } from '../../src/domain/discovery/career-crawler';
import { splitDiscoveryList } from '../../src/domain/discovery/source-classifier';
import { secureTransport } from '../../src/integrations/sources/http';

vi.mock('../../src/db', () => ({
  getDb: () => ({
    insert: () => ({
      values: () => ({
        onConflictDoUpdate: () => ({
          returning: async () => [{ nextRequestAt: new Date() }],
        }),
      }),
    }),
  }),
}));
vi.mock('../../src/integrations/sources/http', async (original) => ({
  ...(await original<typeof import('../../src/integrations/sources/http')>()),
  secureTransport: vi.fn(),
}));
const transport = vi.mocked(secureTransport);
const host = 'https://careers.example.com';
function response(url: string, body = '', status = 200, headers: Record<string, string> = {}) {
  return { url, status, body, headers: new Headers({ 'content-type': 'text/html', ...headers }) };
}
beforeEach(() => {
  transport.mockImplementation(async (url) =>
    url.endsWith('/robots.txt')
      ? response(url, 'User-agent: *\nAllow: /', 200, { 'content-type': 'text/plain' })
      : response(url, '', 404),
  );
});
afterEach(() => vi.clearAllMocks());

describe('discovery crawl boundaries', () => {
  it('checks robots before fetching every redirect destination', async () => {
    transport.mockImplementation(async (url) => {
      if (url.endsWith('/robots.txt')) return response(url, 'User-agent: *\nDisallow: /private');
      if (url.endsWith('/careers')) return response(url, '', 302, { location: '/private/jobs' });
      return response(url, '', 404);
    });
    await crawlCareerSeed(host + '/careers');
    expect(transport.mock.calls.map(([url]) => url)).not.toContain(host + '/private/jobs');
  });

  it('uses a same-host sitemap declared by robots instead of always consuming the budget on /sitemap.xml', async () => {
    transport.mockImplementation(async (url) => {
      if (url.endsWith('/robots.txt'))
        return response(url, `User-agent: *\nAllow: /\nSitemap: ${host}/custom.xml`);
      if (url.endsWith('/custom.xml'))
        return response(url, `<urlset><url><loc>${host}/jobs/engineer</loc></url></urlset>`);
      return response(url, '', 404);
    });
    expect(
      (await crawlCareerSeed(host + '/careers')).map((candidate) => candidate.canonicalUrl),
    ).toContain(host + '/jobs/engineer');
    expect(transport.mock.calls.map(([url]) => url)).not.toContain(host + '/sitemap.xml');
  });

  it('ignores malformed ATS links without discarding valid candidates from the page', async () => {
    transport.mockImplementation(async (url) => {
      if (url.endsWith('/robots.txt')) return response(url, 'User-agent: *\nAllow: /');
      if (url.endsWith('/careers'))
        return response(
          url,
          `<a href="https://jobs.lever.co/invalid?x=${'x'.repeat(4200)}">Invalid</a>` +
            '<a href="https://jobs.lever.co/valid">Valid</a>',
        );
      return response(url, '', 404);
    });
    const candidates = await crawlCareerSeed(host + '/careers');
    expect(candidates.map((candidate) => candidate.boardToken)).toContain('valid');
    expect(candidates.map((candidate) => candidate.boardToken)).not.toContain('invalid');
  });

  it('never follows cross-host redirects', async () => {
    transport.mockImplementation(async (url) => {
      if (url.endsWith('/robots.txt')) return response(url, 'User-agent: *\nAllow: /');
      return response(url, '', 302, { location: 'https://other.example.com/jobs' });
    });
    await crawlCareerSeed(host + '/careers');
    expect(
      transport.mock.calls.every(([url]) => new URL(url).hostname === 'careers.example.com'),
    ).toBe(true);
  });

  it('does not shorten Retry-After to fit the bounded retry window', async () => {
    const requester = vi.fn(async (url: URL) => ({
      url,
      status: 429,
      headers: { 'retry-after': '3600' },
      body: '',
    }));
    const sleep = vi.fn(async () => {});
    expect((await requestWithRetry(new URL(host), requester, sleep)).status).toBe(429);
    expect(requester).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('waits at least the requested short Retry-After', async () => {
    const requester = vi.fn(async (url: URL) => ({
      url,
      status: 429,
      headers: { 'retry-after': '2' },
      body: '',
    }));
    const sleep = vi.fn(async () => {});
    await requestWithRetry(new URL(host), requester, sleep);
    expect(sleep).toHaveBeenCalledTimes(2);
    for (const [ms] of sleep.mock.calls as unknown as [number][])
      expect(ms).toBeGreaterThanOrEqual(2000);
  });

  it('aborts an unresolved request instead of leaving the run stuck', async () => {
    const controller = new AbortController();
    const pending = requestWithRetry(
      new URL(host),
      () => new Promise(() => {}),
      undefined,
      controller.signal,
    );
    const assertion = expect(pending).rejects.toThrow('Stopped fixture crawl');
    controller.abort(new Error('Stopped fixture crawl'));
    await assertion;
  });

  it('splits newline, comma and semicolon lists without splitting hostnames at n', () => {
    expect(
      splitDiscoveryList(
        'jobs.notion.com\ncareers.nigeria.example; hiring.example, jobs.notion.com',
      ),
    ).toEqual(['jobs.notion.com', 'careers.nigeria.example', 'hiring.example']);
  });
});

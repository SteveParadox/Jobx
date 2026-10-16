import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { jobSchema, searchSchema } from '../../src/domain/validation';
import { feedUrl, fetchFeed, parseGreenhouse, parseLever } from '../../src/integrations/feeds';
import { validateResume } from '../../src/integrations/storage';
import { sameOrigin } from '../../src/lib/http';
import { jsonLd, publicUrl, sanitizeDescription, validHmac } from '../../src/lib/security';
import { description, jobInput } from '../helpers';
describe('security boundaries', () => {
  it.each([
    'http://example.com',
    'https://127.0.0.1',
    'https://[::1]',
    'https://169.254.169.254/latest',
    'https://localhost',
    'https://metadata.internal',
    'https://user:pass@example.com',
    'https://example.com:8443',
    'javascript:alert(1)',
    'https://2130706433',
  ])('rejects unsafe URL %s', (url) => expect(() => publicUrl(url)).toThrow());
  it('permits public HTTPS destinations and strips fragments', () =>
    expect(publicUrl('https://careers.example.com/apply#form')).toBe(
      'https://careers.example.com/apply',
    ));
  it('never interpolates arbitrary source URLs or board identifiers', () => {
    expect(() => feedUrl('greenhouse', '../../internal')).toThrow();
    expect(() => feedUrl('custom', 'example')).toThrow();
    expect(feedUrl('lever_eu', 'example')).toContain('api.eu.lever.co/v0/postings/example');
  });
  it('rejects redirected source fetches and malformed payloads', async () => {
    const fetcher = async (_url: RequestInfo | URL, options?: RequestInit) => {
      expect(options?.redirect).toBe('error');
      return new Response('{}');
    };
    await expect(fetchFeed('lever', 'fixture', fetcher as typeof fetch)).rejects.toThrow();
  });
  it('removes script, style, event attributes, forms and unsafe links', () => {
    const html = sanitizeDescription(
      '<p onclick="x()">Role</p><script>alert(1)</script><form><input name=x></form><a href="javascript:x()">Link</a>',
    );
    expect(html).toBe('<p>Role</p>Link');
  });
  it('escapes closing script tags in JSON-LD', () =>
    expect(jsonLd({ title: '</script><script>alert(1)' })).not.toContain('</script>'));
  it('compares webhook HMACs in constant-time and rejects invalid encodings', () => {
    const body = '{"event":"charge.success"}';
    const signature = createHmac('sha512', 'secret').update(body).digest('hex');
    expect(validHmac(body, signature, 'secret')).toBe(true);
    expect(validHmac(body + 'x', signature, 'secret')).toBe(false);
    expect(validHmac(body, 'zz', 'secret')).toBe(false);
  });
  it('requires exact request origin for cookie-authorized mutations', () => {
    expect(() =>
      sameOrigin(
        new Request('http://localhost:3000', { headers: { Origin: 'https://attacker.example' } }),
      ),
    ).toThrow();
    expect(() =>
      sameOrigin(
        new Request('http://localhost:3000', { headers: { Origin: 'http://localhost:3000' } }),
      ),
    ).not.toThrow();
  });
  it('restricts résumé uploads by MIME, header and size', () => {
    expect(() => validateResume(Buffer.from('%PDF-1.7 fixture'), 'application/pdf')).not.toThrow();
    expect(() => validateResume(Buffer.from('<script>evil</script>'), 'application/pdf')).toThrow();
    expect(() => validateResume(Buffer.alloc(6 * 1024 * 1024), 'application/pdf')).toThrow();
    expect(() => validateResume(Buffer.from('%PDF-1.7 fixture'), 'text/html')).toThrow();
  });
});
describe('truthful validation', () => {
  it('does not infer compensation or sponsorship', () => {
    const job = jobSchema.parse(jobInput);
    expect(job.salaryMin).toBeUndefined();
    expect(job.visaSponsorship).toBeUndefined();
  });
  it('rejects invented remote eligibility and contradictory compensation', () => {
    expect(() => jobSchema.parse({ ...jobInput, workplace: 'remote' })).toThrow();
    expect(() => jobSchema.parse({ ...jobInput, salaryMin: 10 })).toThrow();
    expect(() =>
      jobSchema.parse({
        ...jobInput,
        salaryMin: 20,
        salaryMax: 10,
        currency: 'USD',
        salaryPeriod: 'YEAR',
      }),
    ).toThrow();
  });
  it('bounds search cost and validates currency comparability', () => {
    expect(() => searchSchema.parse({ page: 1001 })).toThrow();
    expect(() => searchSchema.parse({ q: 'x'.repeat(161) })).toThrow();
    expect(() => searchSchema.parse({ salaryMin: 10 })).toThrow();
  });
  it('keeps source location labels without guessing country or remote work', () => {
    const jobs = parseGreenhouse({
      jobs: [
        {
          id: 1,
          title: 'Engineer',
          absolute_url: 'https://careers.example.com/1',
          content: description,
          location: { name: 'Remote' },
        },
      ],
    });
    expect(jobs[0].data.workplace).toBe('unknown');
    expect(jobs[0].data.country).toBeUndefined();
    expect(jobs[0].data.remoteCountries).toEqual([]);
  });
  it('keeps a genuine Lever original date', () => {
    const timestamp = Date.UTC(2024, 0, 1);
    const [job] = parseLever([
      {
        id: '1',
        text: 'Engineer',
        hostedUrl: 'https://jobs.example.com/1',
        applyUrl: 'https://jobs.example.com/1/apply',
        description,
        createdAt: timestamp,
      },
    ]);
    expect(job.data.originalPostedAt).toBe('2024-01-01T00:00:00.000Z');
  });
});

describe('authorized imports', () => {
  it('validates complete JSON records without inventing unknown fields', async () => {
    const { parseAuthorizedImport } = await import('../../src/integrations/imports');
    const [record] = parseAuthorizedImport(
      'json',
      JSON.stringify([
        {
          externalId: 'a',
          sourceUrl: 'https://careers.example.com/a',
          ...jobInput,
          applicationMethod: 'external',
          applyUrl: 'https://careers.example.com/a/apply',
        },
      ]),
    );
    expect(record.externalId).toBe('a');
    expect(record.data.salaryMin).toBeUndefined();
  });
  it('parses quoted CSV fields and semicolon-delimited skills', async () => {
    const { parseAuthorizedImport } = await import('../../src/integrations/imports');
    const csv =
      'externalId,sourceUrl,title,descriptionHtml,locationLabel,country,workplace,applyUrl,skills\n' +
      'a,https://careers.example.com/a,Engineer,"' +
      description.replaceAll('"', '""') +
      '","Lagos, Nigeria",NG,onsite,https://careers.example.com/a/apply,TypeScript;PostgreSQL';
    expect(parseAuthorizedImport('csv', csv)[0].data.skills).toEqual(['TypeScript', 'PostgreSQL']);
  });
  it('parses XML and rejects entity/document-type declarations', async () => {
    const { parseAuthorizedImport } = await import('../../src/integrations/imports');
    const xml =
      '<jobs><job><externalId>a</externalId><sourceUrl>https://careers.example.com/a</sourceUrl><title>Engineer</title><descriptionHtml><![CDATA[' +
      description +
      ']]></descriptionHtml><locationLabel>Lagos</locationLabel><country>NG</country><workplace>onsite</workplace><applyUrl>https://careers.example.com/a/apply</applyUrl></job></jobs>';
    expect(parseAuthorizedImport('xml', xml)).toHaveLength(1);
    expect(() =>
      parseAuthorizedImport(
        'xml',
        '<!DOCTYPE jobs [<!ENTITY x SYSTEM "file:///etc/passwd">]><jobs/>',
      ),
    ).toThrow();
  });
  it('rejects malformed records instead of silently dropping them', async () => {
    const { parseAuthorizedImport } = await import('../../src/integrations/imports');
    expect(() => parseAuthorizedImport('json', '[{"externalId":"a"}]')).toThrow();
  });
});

it('rejects streamed requests before accumulating an oversized JSON body', async () => {
  const { rawBody } = await import('../../src/lib/http');
  await expect(
    rawBody(new Request('http://localhost:3000', { method: 'POST', body: 'x'.repeat(100) }), 50),
  ).rejects.toMatchObject({ status: 413 });
});

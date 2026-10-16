import { describe, expect, it, vi } from 'vitest';
import type { PublicJob } from '../../src/domain/search';
import { jobSchema, metadata, sitemapXml, splitSitemap } from '../../src/domain/seo';
vi.hoisted(() => {
  process.env.APP_ENV = 'production';
  process.env.SITE_URL = 'https://careeratlas.example.com';
});
const fixture: PublicJob = {
  id: 'f584d278-673c-4879-a843-8ec0502b66ab',
  slug: 'engineer',
  title: 'Engineer',
  descriptionText:
    'Build, test and support software with a product team. Document your approach and improve reliability through review.',
  descriptionHtml:
    '<p>Build, test and support software with a product team. Document your approach and improve reliability through review.</p>',
  employerId: '293899f8-2900-481b-a857-a884bfa85399',
  companyName: 'Fixture Company',
  companySlug: 'fixture',
  companyWebsite: 'https://company.example.com',
  companyVerified: 'verified',
  companyLogo: null,
  locationLabel: 'Lagos, Nigeria',
  country: 'NG',
  region: null,
  city: 'Lagos',
  workplace: 'onsite',
  remoteCountries: [],
  employmentType: 'FULL_TIME',
  seniority: null,
  category: null,
  skills: [],
  education: null,
  experienceMin: null,
  visaSponsorship: null,
  salaryMin: null,
  salaryMax: null,
  currency: null,
  salaryPeriod: null,
  applicationMethod: 'external',
  resumeRequired: false,
  applyUrl: 'https://careers.example.com/apply',
  status: 'active',
  isDemo: false,
  originalPostedAt: new Date('2026-10-01T00:00:00Z'),
  lastVerifiedAt: new Date(),
  expiresAt: new Date('2099-01-01T00:00:00Z'),
  updatedAt: new Date(),
};
describe('JobPosting generation', () => {
  it('contains real required fields matching visible data', () => {
    const schema = jobSchema(fixture)!;
    expect(schema['@type']).toBe('JobPosting');
    expect(schema.title).toBe(fixture.title);
    expect(schema.description).toBe(fixture.descriptionHtml);
    expect(schema.datePosted).toBe('2026-10-01T00:00:00.000Z');
    expect(schema.hiringOrganization.name).toBe(fixture.companyName);
    expect(schema).not.toHaveProperty('baseSalary');
    expect(schema).not.toHaveProperty('directApply');
  });
  it('uses remote eligibility only for fully remote work', () => {
    const remote = jobSchema({ ...fixture, workplace: 'remote', remoteCountries: ['NG', 'GB'] })!;
    expect(remote).toHaveProperty('jobLocationType', 'TELECOMMUTE');
    expect(remote).toHaveProperty('applicantLocationRequirements');
    expect(remote).not.toHaveProperty('jobLocation');
    const hybrid = jobSchema({ ...fixture, workplace: 'hybrid' })!;
    expect(hybrid).not.toHaveProperty('jobLocationType');
    expect(hybrid).toHaveProperty('jobLocation');
  });
  it.each(['closed', 'expired', 'paused', 'draft'])('omits active markup for %s jobs', (status) =>
    expect(jobSchema({ ...fixture, status })).toBeNull(),
  );
  it('omits expired, demo, undated and insufficiently located records', () => {
    for (const change of [
      { expiresAt: new Date('2020-01-01') },
      { isDemo: true },
      { originalPostedAt: null },
      { country: null },
      { workplace: 'remote', remoteCountries: [] },
    ])
      expect(jobSchema({ ...fixture, ...change })).toBeNull();
  });
  it('emits only explicitly disclosed salary currency and period', () => {
    const schema = jobSchema({
      ...fixture,
      salaryMin: 60000,
      salaryMax: 80000,
      currency: 'USD',
      salaryPeriod: 'YEAR',
    })!;
    expect(schema.baseSalary).toMatchObject({
      currency: 'USD',
      value: { minValue: 60000, maxValue: 80000, unitText: 'YEAR' },
    });
  });
  it('sets canonical and noindex for internal search', () => {
    const m = metadata('Search', 'Find jobs', '/jobs', false);
    expect(m.alternates?.canonical).toBe('https://careeratlas.example.com/jobs');
    expect(m.robots).toMatchObject({ index: false, follow: true });
  });
});
describe('sitemap protocol limits', () => {
  it('splits at 50,000 URLs', () => {
    const chunks = splitSitemap(
      Array.from({ length: 50001 }, (_, i) => i),
      () => 20,
    );
    expect(chunks.map((v) => v.length)).toEqual([50000, 1]);
  });
  it('splits by UTF-8 entry size before the byte limit', () => {
    expect(splitSitemap([1, 2, 3], () => 150, 50000, 500).map((v) => v.length)).toEqual([2, 1]);
  });
  it('escapes URLs and uses material modification dates', () => {
    const xml = sitemapXml([
      { url: 'https://example.com/job?a=1&b=2', updatedAt: new Date('2026-01-01') },
    ]);
    expect(xml).toContain('&amp;');
    expect(xml).toContain('2026-01-01T00:00:00.000Z');
  });
});

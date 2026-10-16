import { brand, isProduction } from '@/lib/config';
import type { Metadata } from 'next';
import type { PublicJob } from './search';
export const jobPath = (job: { id: string; slug: string }) => `/job/${job.id}/${job.slug}`;
export function active(job: Pick<PublicJob, 'status' | 'expiresAt'>, now = new Date()) {
  return job.status === 'active' && (!job.expiresAt || new Date(job.expiresAt) > now);
}
export function eligible(job: PublicJob) {
  return (
    isProduction &&
    !job.isDemo &&
    active(job) &&
    Boolean(job.originalPostedAt) &&
    new Date(job.originalPostedAt!) <= new Date() &&
    job.descriptionText.length >= 80 &&
    Boolean(job.companyName) &&
    Boolean(job.workplace === 'remote' ? job.remoteCountries.length : job.country)
  );
}
export function jobSchema(job: PublicJob) {
  if (!eligible(job)) return null;
  return {
    '@context': 'https://schema.org',
    '@type': 'JobPosting',
    title: job.title,
    description: job.descriptionHtml,
    datePosted: new Date(job.originalPostedAt!).toISOString(),
    identifier: { '@type': 'PropertyValue', name: job.companyName, value: job.id },
    hiringOrganization: {
      '@type': 'Organization',
      name: job.companyName,
      sameAs: job.companyWebsite,
      ...(job.companyLogo ? { logo: job.companyLogo } : {}),
    },
    ...(job.workplace === 'remote'
      ? {
          jobLocationType: 'TELECOMMUTE',
          applicantLocationRequirements: job.remoteCountries.map((name) => ({
            '@type': 'Country',
            name,
          })),
        }
      : {
          jobLocation: {
            '@type': 'Place',
            address: {
              '@type': 'PostalAddress',
              addressCountry: job.country,
              ...(job.city ? { addressLocality: job.city } : {}),
              ...(job.region ? { addressRegion: job.region } : {}),
            },
          },
        }),
    ...(job.employmentType ? { employmentType: job.employmentType } : {}),
    ...(job.expiresAt ? { validThrough: new Date(job.expiresAt).toISOString() } : {}),
    ...((job.salaryMin != null || job.salaryMax != null) && job.currency && job.salaryPeriod
      ? {
          baseSalary: {
            '@type': 'MonetaryAmount',
            currency: job.currency,
            value: {
              '@type': 'QuantitativeValue',
              ...(job.salaryMin != null ? { minValue: job.salaryMin } : {}),
              ...(job.salaryMax != null ? { maxValue: job.salaryMax } : {}),
              unitText: job.salaryPeriod,
            },
          },
        }
      : {}),
    url: brand.url + jobPath(job),
  };
}
export function metadata(title: string, description: string, path: string, index = true): Metadata {
  return {
    title,
    description,
    alternates: { canonical: brand.url + path },
    robots: { index: isProduction && index, follow: true },
    openGraph: { title, description, url: brand.url + path, type: 'website', siteName: brand.name },
    twitter: { card: 'summary', title, description },
  };
}
export function breadcrumb(items: { name: string; path: string }[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((v, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: v.name,
      item: brand.url + v.path,
    })),
  };
}
export function sitemapXml(items: { url: string; updatedAt: Date }[]) {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${items.map((v) => `<url><loc>${esc(v.url)}</loc><lastmod>${v.updatedAt.toISOString()}</lastmod></url>`).join('')}</urlset>`;
}
export function splitSitemap<T>(
  items: T[],
  sizeOf: (v: T) => number,
  maxUrls = 50000,
  maxBytes = 49 * 1024 * 1024,
) {
  const result: T[][] = [];
  let batch: T[] = [];
  let bytes = 200;
  for (const item of items) {
    const size = sizeOf(item);
    if (size + 200 > maxBytes) throw new Error('A sitemap entry exceeds file size');
    if (batch.length >= maxUrls || bytes + size > maxBytes) {
      result.push(batch);
      batch = [];
      bytes = 200;
    }
    batch.push(item);
    bytes += size;
  }
  if (batch.length) result.push(batch);
  return result;
}

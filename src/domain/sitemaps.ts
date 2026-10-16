import { getDb } from '@/db';
import { editorial, employers, jobs, settings } from '@/db/schema';
import { brand, env, isProduction } from '@/lib/config';
import { and, asc, eq, isNotNull, sql } from 'drizzle-orm';
import { guides } from './content';
import { getLanding } from './landings';
import { availability } from './search';
import { jobPath, sitemapXml } from './seo';
export const SITEMAP_PAGE_SIZE = 10000;
export const materialDate = new Date('2026-10-16T00:00:00Z');
export const staticPaths = [
  '/',
  '/companies',
  '/resources',
  '/about',
  '/contact',
  '/faq',
  '/help',
  '/trust',
  '/accessibility',
  '/pricing',
];
function jobEligibility() {
  return and(
    availability(),
    isNotNull(jobs.originalPostedAt),
    sql`(${jobs.workplace}='remote' and cardinality(${jobs.remoteCountries})>0 or ${jobs.workplace}<>'remote' and ${jobs.country} is not null)`,
  );
}
export async function sitemapIndex() {
  if (!isProduction) return [];
  const db = env.DATABASE_URL ? getDb() : null;
  const count = db
    ? (
        await db
          .select({ count: sql<number>`count(*)::int` })
          .from(jobs)
          .innerJoin(employers, eq(jobs.employerId, employers.id))
          .where(jobEligibility())
      )[0].count
    : 0;
  const companyCount = db
    ? (
        await db
          .select({ count: sql<number>`count(distinct ${employers.id})::int` })
          .from(employers)
          .innerJoin(jobs, eq(jobs.employerId, employers.id))
          .where(availability())
      )[0].count
    : 0;
  const editorialCount = db
    ? (
        await db
          .select({ count: sql<number>`count(*)::int` })
          .from(editorial)
          .where(eq(editorial.published, true))
      )[0].count
    : 0;
  return [
    ...Array.from({ length: Math.ceil(count / SITEMAP_PAGE_SIZE) }, (_, i) => `jobs/${i}`),
    ...Array.from(
      { length: Math.ceil(companyCount / SITEMAP_PAGE_SIZE) },
      (_, i) => `companies/${i}`,
    ),
    ...Array.from(
      { length: Math.ceil((editorialCount + Object.keys(guides).length) / SITEMAP_PAGE_SIZE) },
      (_, i) => `editorial/${i}`,
    ),
    'landings/0',
    'static/0',
  ].map((v) => `${brand.url}/sitemaps/${v}.xml`);
}
export async function sitemapEntries(kind: string, page: number) {
  if (!isProduction) return [];
  const db = env.DATABASE_URL ? getDb() : null;
  const offset = page * SITEMAP_PAGE_SIZE;
  if (kind === 'static')
    return page
      ? []
      : staticPaths.map((path) => ({ url: brand.url + path, updatedAt: materialDate }));
  if (kind === 'jobs' && db) {
    const rows = await db
      .select({ id: jobs.id, slug: jobs.slug, updatedAt: jobs.updatedAt })
      .from(jobs)
      .innerJoin(employers, eq(jobs.employerId, employers.id))
      .where(jobEligibility())
      .orderBy(asc(jobs.id))
      .limit(SITEMAP_PAGE_SIZE)
      .offset(offset);
    return rows.map((v) => ({ url: brand.url + jobPath(v), updatedAt: v.updatedAt }));
  }
  if (kind === 'companies' && db) {
    const rows = await db
      .select({ slug: employers.slug, updatedAt: employers.updatedAt })
      .from(employers)
      .innerJoin(jobs, eq(jobs.employerId, employers.id))
      .where(availability())
      .groupBy(employers.id)
      .orderBy(asc(employers.id))
      .limit(SITEMAP_PAGE_SIZE)
      .offset(offset);
    return rows.map((v) => ({ url: brand.url + '/companies/' + v.slug, updatedAt: v.updatedAt }));
  }
  if (kind === 'editorial') {
    const builtins = Object.keys(guides).map((slug) => ({ slug, updatedAt: materialDate }));
    const rows = db
      ? await db
          .select({ slug: editorial.slug, updatedAt: editorial.updatedAt })
          .from(editorial)
          .where(eq(editorial.published, true))
          .orderBy(asc(editorial.slug))
      : [];
    return [...builtins, ...rows.filter((r) => !guides[r.slug])]
      .slice(offset, offset + SITEMAP_PAGE_SIZE)
      .map((v) => ({ url: brand.url + '/resources/' + v.slug, updatedAt: v.updatedAt }));
  }
  if (kind === 'landings' && db && page === 0) {
    const candidates = await db
      .select()
      .from(settings)
      .where(sql`${settings.key} like 'landing:%'`)
      .limit(1000);
    const result = [];
    for (const item of candidates) {
      const path = item.key.slice('landing:'.length);
      const landing = await getLanding(path);
      if (landing) result.push({ url: brand.url + path, updatedAt: landing.updatedAt });
    }
    return result;
  }
  return [];
}
export function renderSitemap(entries: { url: string; updatedAt: Date }[]) {
  const xml = sitemapXml(entries);
  if (entries.length > 50000 || Buffer.byteLength(xml) > 50 * 1024 * 1024)
    throw new Error('Sitemap protocol limit exceeded');
  return xml;
}

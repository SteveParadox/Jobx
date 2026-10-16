import { getDb } from '@/db';
import { employers, jobs, placements } from '@/db/schema';
import { env, isProduction } from '@/lib/config';
import { and, desc, eq, gt, gte, ilike, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { searchSchema, type SearchFilters } from './validation';
export const PAGE_SIZE = 20;
const synonyms: Record<string, string> = {
  js: 'javascript',
  ts: 'typescript',
  nodejs: 'node',
  postgres: 'postgresql',
  frontend: 'front end',
  backend: 'back end',
};
export function normalizeQuery(q: string) {
  return q
    .toLowerCase()
    .replace(/\b(js|ts|nodejs|postgres|frontend|backend)\b/g, (v) => synonyms[v])
    .replace(/\s+/g, ' ')
    .trim();
}
export const publicJobFields = {
  id: jobs.id,
  slug: jobs.slug,
  title: jobs.title,
  descriptionText: jobs.descriptionText,
  descriptionHtml: jobs.descriptionHtml,
  locationLabel: jobs.locationLabel,
  country: jobs.country,
  region: jobs.region,
  city: jobs.city,
  workplace: jobs.workplace,
  remoteCountries: jobs.remoteCountries,
  employmentType: jobs.employmentType,
  seniority: jobs.seniority,
  category: jobs.category,
  skills: jobs.skills,
  education: jobs.education,
  experienceMin: jobs.experienceMin,
  visaSponsorship: jobs.visaSponsorship,
  salaryMin: jobs.salaryMin,
  salaryMax: jobs.salaryMax,
  currency: jobs.currency,
  salaryPeriod: jobs.salaryPeriod,
  applicationMethod: jobs.applicationMethod,
  resumeRequired: jobs.resumeRequired,
  applyUrl: jobs.applyUrl,
  status: jobs.status,
  isDemo: jobs.isDemo,
  originalPostedAt: jobs.originalPostedAt,
  lastVerifiedAt: jobs.lastVerifiedAt,
  expiresAt: jobs.expiresAt,
  updatedAt: jobs.updatedAt,
  employerId: employers.id,
  companyName: employers.name,
  companySlug: employers.slug,
  companyWebsite: employers.website,
  companyVerified: employers.verificationStatus,
  companyLogo: employers.logoUrl,
};
export type PublicJob = NonNullable<Awaited<ReturnType<typeof getPublicJob>>>;
export const sourcePermission = () =>
  sql`(${jobs.sourceOwnerId} is null or exists(select 1 from job_sources source where source.id=${jobs.sourceOwnerId} and source.enabled=true and source.approval_status='approved' and (source.authorization_expires_at is null or source.authorization_expires_at>now())))`;
export function availability(now = new Date()) {
  return and(
    eq(jobs.status, 'active'),
    or(isNull(jobs.expiresAt), gt(jobs.expiresAt, now)),
    eq(employers.disabled, false),
    eq(employers.verificationStatus, 'verified'),
    sourcePermission(),
    ...(isProduction || !env.DEMO_MODE
      ? [eq(jobs.isDemo, false), eq(employers.isDemo, false)]
      : []),
  );
}
export function searchConditions(f: SearchFilters, now = new Date()) {
  const conditions = [availability(now)];
  const q = normalizeQuery(f.q);
  if (q)
    conditions.push(
      sql`(jobs.search_vector @@ websearch_to_tsquery('english', ${q}) OR similarity(jobs.title, ${q}) > 0.22 OR ${employers.name} ILIKE ${'%' + q.replace(/[%_\\]/g, '\\$&') + '%'})`,
    );
  for (const [key, column] of Object.entries({
    country: jobs.country,
    region: jobs.region,
    city: jobs.city,
    workplace: jobs.workplace,
    category: jobs.category,
    seniority: jobs.seniority,
    employmentType: jobs.employmentType,
    education: jobs.education,
  }) as [keyof SearchFilters, typeof jobs.country][])
    if (f[key]) {
      const value = String(f[key]).trim();
      conditions.push(
        key === 'country'
          ? eq(column, value.toUpperCase())
          : ['city', 'region', 'category', 'seniority', 'education'].includes(key)
            ? sql`lower(${column})=lower(${value})`
            : eq(column, value),
      );
    }
  if (f.industry) conditions.push(sql`lower(${employers.industry})=lower(${f.industry})`);
  if (f.company) conditions.push(eq(jobs.employerId, f.company));
  if (f.eligibleCountry)
    conditions.push(
      and(
        eq(jobs.workplace, 'remote'),
        sql`${jobs.remoteCountries} @> ARRAY[${f.eligibleCountry.toUpperCase()}]::text[]`,
      ),
    );
  if (f.visa) conditions.push(eq(jobs.visaSponsorship, f.visa === 'true'));
  if (f.experienceMax !== undefined) conditions.push(lte(jobs.experienceMin, f.experienceMax));
  if (f.currency) conditions.push(eq(jobs.currency, f.currency));
  if (f.salaryPeriod) conditions.push(eq(jobs.salaryPeriod, f.salaryPeriod));
  if (f.salaryMin !== undefined) conditions.push(gte(jobs.salaryMin, f.salaryMin));
  if (f.days)
    conditions.push(gte(jobs.originalPostedAt, new Date(now.getTime() - f.days * 86400000)));
  return and(...conditions);
}
export async function searchJobs(input: unknown) {
  const f = searchSchema.parse(input);
  const db = getDb();
  const q = normalizeQuery(f.q);
  const where = searchConditions(f);
  const rank = sql<number>`ts_rank_cd(jobs.search_vector, websearch_to_tsquery('english', ${q})) + similarity(jobs.title, ${q}) * 0.3 + 0.1 / (1 + greatest(0,extract(epoch from (now()-coalesce(jobs.original_posted_at,jobs.first_discovered_at)))/86400)) + case when jobs.last_verified_at>now()-interval '7 days' then 0.02 else 0 end`;
  const order =
    f.sort === 'salary'
      ? [desc(jobs.salaryMin), desc(jobs.id)]
      : f.sort === 'recent' || !q
        ? [desc(jobs.originalPostedAt), desc(jobs.createdAt), desc(jobs.id)]
        : [desc(rank), desc(jobs.originalPostedAt), desc(jobs.id)];
  const [rows, counts] = await Promise.all([
    db
      .select({
        ...publicJobFields,
        sponsored: sql<boolean>`exists(select 1 from ${placements} where ${placements.jobId}=${jobs.id} and ${placements.startsAt}<=now() and ${placements.endsAt}>now())`,
      })
      .from(jobs)
      .innerJoin(employers, eq(jobs.employerId, employers.id))
      .where(where)
      .orderBy(...order)
      .limit(PAGE_SIZE)
      .offset((f.page - 1) * PAGE_SIZE),
    db
      .select({ count: sql<number>`count(*)::integer` })
      .from(jobs)
      .innerJoin(employers, eq(jobs.employerId, employers.id))
      .where(where),
  ]);
  return { jobs: rows, total: counts[0].count, page: f.page, pageSize: PAGE_SIZE };
}
export async function getPublicJob(id: string) {
  return (
    await getDb()
      .select(publicJobFields)
      .from(jobs)
      .innerJoin(employers, eq(jobs.employerId, employers.id))
      .where(
        and(
          eq(jobs.id, id),
          inArray(jobs.status, ['active', 'closed', 'expired']),
          sql`(${jobs.status}='active' or not exists(select 1 from source_job_mappings where job_id=${jobs.id}))`,
          eq(employers.disabled, false),
          eq(employers.verificationStatus, 'verified'),
          sourcePermission(),
          ...(isProduction || !env.DEMO_MODE
            ? [eq(jobs.isDemo, false), eq(employers.isDemo, false)]
            : []),
        ),
      )
      .limit(1)
  )[0];
}
export async function suggestions(q: string) {
  if (q.trim().length < 2) return [];
  return getDb()
    .selectDistinct({ title: jobs.title })
    .from(jobs)
    .innerJoin(employers, eq(jobs.employerId, employers.id))
    .where(and(availability(), ilike(jobs.title, `${q.slice(0, 80).replace(/[%_\\]/g, '\\$&')}%`)))
    .limit(8);
}
export async function inventory() {
  return getDb()
    .select({ category: jobs.category, count: sql<number>`count(*)::integer` })
    .from(jobs)
    .innerJoin(employers, eq(jobs.employerId, employers.id))
    .where(availability())
    .groupBy(jobs.category)
    .orderBy(desc(sql`count(*)`))
    .limit(8);
}

export async function jobProvenance(jobId: string) {
  const { mappings, sources } = await import('@/db/schema');
  return getDb()
    .select({
      attribution: sources.attribution,
      provider: sources.provider,
      sourceUrl: mappings.sourceUrl,
      enabled: sources.enabled,
    })
    .from(mappings)
    .innerJoin(sources, eq(mappings.sourceId, sources.id))
    .where(
      and(
        eq(mappings.jobId, jobId),
        eq(sources.enabled, true),
        eq(sources.approvalStatus, 'approved'),
        or(isNull(sources.authorizationExpiresAt), gt(sources.authorizationExpiresAt, new Date())),
      ),
    );
}

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import countries from 'i18n-iso-countries';
import en from 'i18n-iso-countries/langs/en.json' with { type: 'json' };
import { and, eq, or } from 'drizzle-orm';
import { getDb } from '../db';
import * as s from '../db/schema';
import { env } from '../lib/config';
import { digest, plainText, publicUrl, slugify } from '../lib/security';
import type { FeedJob } from './sources/contracts';
import { normalizedRecord } from './sources/normalize';
countries.registerLocale(en);
const DEFAULT_ACTOR_ID = 'fantastic-jobs~career-site-job-listing-api';
export const defaultApifyInput = {
  timeRange: '24h',
  limit: 20,
  descriptionType: 'html',
  includeCompanyDetails: true,
  removeAgency: true,
  locationSearch: ['Nigeria'],
  titleSearch: ['Engineer', 'Developer', 'Designer', 'Analyst', 'Manager'],
};
export type ApifyImportOptions = {
  token?: string;
  actorId?: string;
  input?: Record<string, unknown>;
  datasetFile?: string;
  timeoutSecs?: number;
  dryRun?: boolean;
  logger?: (message: string) => void;
};
export type ApifyImportResult = {
  fetched: number;
  ready: number;
  imported: number;
  existing: number;
  skipped: number;
};
type Candidate = {
  feed: FeedJob;
  employer: {
    name: string;
    slug: string;
    website: string;
    description: string;
    industry?: string;
    headquarters?: string;
    size?: string;
    logoUrl?: string;
  };
};
const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');
const list = (value: unknown): string[] => {
  if (!Array.isArray(value)) return typeof value === 'string' && value.trim() ? [value.trim()] : [];
  return value
    .map((entry) => {
      if (typeof entry === 'string') return entry.trim();
      if (entry && typeof entry === 'object' && 'name' in entry)
        return text((entry as { name?: unknown }).name);
      return '';
    })
    .filter(Boolean);
};
const isoDate = (value: unknown) => {
  const raw = text(value);
  if (!raw) return undefined;
  const parsed = new Date(raw);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : undefined;
};
const alpha2 = (name: string) => countries.getAlpha2Code(name, 'en');
function countryFromName(value: string) {
  const direct = alpha2(value);
  if (direct) return direct;
  const parts = value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  for (let index = parts.length - 1; index >= 0; index--) {
    const code = alpha2(parts[index]);
    if (code) return code;
  }
  return undefined;
}
const salaryPeriods = ['HOUR', 'DAY', 'WEEK', 'MONTH', 'YEAR'] as const;
const employmentTypes = [
  'FULL_TIME',
  'PART_TIME',
  'CONTRACTOR',
  'TEMPORARY',
  'INTERN',
  'VOLUNTEER',
  'PER_DIEM',
  'OTHER',
] as const;
function salaryPeriod(value: unknown) {
  const unit = text(value).toUpperCase();
  return salaryPeriods.find((period) => unit.includes(period));
}
function number(value: unknown) {
  if (value === null || value === undefined || value === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : undefined;
}
function experience(value: unknown) {
  const level = text(value);
  if (level === '0-2') return { experienceMin: 0, seniority: 'junior' };
  if (level === '2-5') return { experienceMin: 2, seniority: 'mid' };
  if (level === '5-10') return { experienceMin: 5, seniority: 'senior' };
  if (level === '10+') return { experienceMin: 10, seniority: 'lead' };
  return {};
}
function safeUrl(...values: unknown[]) {
  for (const value of values) {
    const candidate = text(value);
    if (!candidate) continue;
    try {
      return publicUrl(candidate.startsWith('http') ? candidate : `https://${candidate}`);
    } catch {
      continue;
    }
  }
  return undefined;
}
function mapItem(item: Record<string, unknown>): Candidate | { skip: string } {
  const applyUrl = text(item.url);
  if (!applyUrl) return { skip: 'missing application URL' };
  const title = text(item.title);
  if (!title) return { skip: 'missing title' };
  const description = text(item.description_html) || text(item.description);
  if (!description) return { skip: 'missing description' };
  const workplaceText = text(item.ai_work_arrangement).toLowerCase();
  const workplace = workplaceText.includes('remote')
    ? 'remote'
    : workplaceText.includes('hybrid')
      ? 'hybrid'
      : workplaceText.includes('on-site') || workplaceText.includes('onsite')
        ? 'onsite'
        : 'unknown';
  const expiresAt = isoDate(item.date_valid_through);
  if (expiresAt && Date.parse(expiresAt) <= Date.now()) return { skip: 'posting has expired' };
  const countryNames = list(item.countries_derived);
  const country = countryNames.map(countryFromName).find(Boolean);
  if (workplace !== 'remote' && !country)
    return { skip: 'missing normalized country for physical workplace' };
  const remoteCountries = [
    ...new Set(
      [
        ...list(item.ai_remote_location),
        ...list(item.ai_remote_location_derived),
        ...list(item.location_requirements),
        ...countryNames,
      ]
        .map(countryFromName)
        .filter((code): code is string => Boolean(code)),
    ),
  ];
  if (workplace === 'remote' && remoteCountries.length === 0)
    return { skip: 'remote role without explicit applicant countries' };
  const salary = {
    salaryMin: number(item.ai_salary_min_value ?? item.ai_salary_value),
    salaryMax: number(item.ai_salary_max_value ?? item.ai_salary_value),
    currency: /^[A-Z]{3}$/.test(text(item.ai_salary_currency).toUpperCase())
      ? text(item.ai_salary_currency).toUpperCase()
      : undefined,
    salaryPeriod: salaryPeriod(item.ai_salary_unit_text),
  };
  const hasSalary = Boolean(
    salary.currency &&
    salary.salaryPeriod &&
    (salary.salaryMin != null || salary.salaryMax != null),
  );
  const employmentType = list(item.ai_employment_type).find((value) =>
    (employmentTypes as readonly string[]).includes(value),
  );
  let feed: FeedJob;
  try {
    feed = normalizedRecord({
      externalId: text(item.id) || digest(applyUrl),
      sourceUrl: applyUrl,
      applyUrl,
      title,
      descriptionHtml: description,
      locationLabel:
        list(item.locations_derived)[0] ||
        list(item.locations_alt)[0] ||
        list(item.ai_remote_location)[0] ||
        'Location not specified',
      country: country ?? undefined,
      region: list(item.regions_derived)[0],
      city: list(item.cities_derived)[0],
      workplace,
      remoteCountries,
      employmentType,
      category: list(item.ai_taxonomies_a)[0] || text(item.source) || undefined,
      seniority: experience(item.ai_experience_level).seniority,
      skills: list(item.ai_key_skills).slice(0, 50),
      experienceMin: experience(item.ai_experience_level).experienceMin,
      education: text(item.ai_education) || undefined,
      visaSponsorship:
        typeof item.ai_visa_sponsorship === 'boolean' ? item.ai_visa_sponsorship : undefined,
      ...(hasSalary ? salary : {}),
      originalPostedAt: isoDate(item.date_posted),
      expiresAt,
      sourcePostedAt: isoDate(item.date_posted),
    });
  } catch (error) {
    return { skip: error instanceof Error ? error.message : 'normalization failed' };
  }
  const name = text(item.organization) || text(item.org_linkedin_name);
  if (!name) return { skip: 'missing organization name' };
  const website = safeUrl(
    item.org_linkedin_website,
    item.domain_derived,
    item.organization_url,
    item.url,
  );
  if (!website) return { skip: 'missing employer website' };
  return {
    feed,
    employer: {
      name,
      slug: `${slugify(name).slice(0, 60)}-${digest(`${name}|${website}`).slice(0, 8)}`,
      website,
      description: text(item.org_linkedin_description).slice(0, 10000),
      industry: text(item.org_linkedin_industry) || undefined,
      headquarters: text(item.org_linkedin_headquarters) || undefined,
      size: text(item.org_linkedin_size) || undefined,
      logoUrl: safeUrl(item.org_logo_permalink, item.organization_logo),
    },
  };
}
async function fetchItems(options: ApifyImportOptions): Promise<Record<string, unknown>[]> {
  if (options.datasetFile)
    return JSON.parse(readFileSync(options.datasetFile, 'utf8')) as Record<string, unknown>[];
  const token = options.token ?? process.env.APIFY_TOKEN?.trim();
  if (!token) throw new Error('APIFY_TOKEN is required (or set APIFY_DATASET_FILE)');
  const actorId = options.actorId ?? process.env.APIFY_ACTOR_ID?.trim() ?? DEFAULT_ACTOR_ID;
  const configuredTimeout = Number(process.env.APIFY_TIMEOUT_SECS ?? 300);
  const timeoutSecs =
    options.timeoutSecs ??
    (Number.isFinite(configuredTimeout) && configuredTimeout > 0 ? configuredTimeout : 300);
  const input = options.input ?? defaultApifyInput;
  const response = await fetch(
    `https://api.apify.com/v2/acts/${encodeURIComponent(actorId)}/run-sync-get-dataset-items?timeout=${timeoutSecs}`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout((timeoutSecs + 30) * 1000),
    },
  );
  if (!response.ok)
    throw new Error(`Apify request failed: ${response.status} ${await response.text()}`);
  const body = (await response.json()) as unknown;
  if (!Array.isArray(body)) throw new Error('Expected an array of dataset items');
  return body.filter((value): value is Record<string, unknown> =>
    Boolean(value && typeof value === 'object'),
  );
}
export async function importApifyJobs(
  options: ApifyImportOptions = {},
): Promise<ApifyImportResult> {
  const logger = options.logger ?? (() => {});
  const items = await fetchItems(options);
  const candidates: Candidate[] = [];
  for (const item of items) {
    const mapped = mapItem(item);
    if ('skip' in mapped) {
      logger(`SKIP ${text(item.title) || '(untitled)'}: ${mapped.skip}`);
      continue;
    }
    candidates.push(mapped);
  }
  if (options.dryRun) {
    for (const candidate of candidates)
      logger(
        `READY ${candidate.employer.name} | ${candidate.feed.data.title} | ${candidate.feed.data.locationLabel} | ${candidate.feed.data.workplace} | ${candidate.feed.data.applicationMethod}`,
      );
    return {
      fetched: items.length,
      ready: candidates.length,
      imported: 0,
      existing: 0,
      skipped: items.length - candidates.length,
    };
  }
  const db = getDb();
  let inserted = 0;
  let existing = 0;
  await db.transaction(async (tx) => {
    for (const candidate of candidates) {
      const [foundEmployer] = await tx
        .select()
        .from(s.employers)
        .where(
          or(
            eq(s.employers.slug, candidate.employer.slug),
            eq(s.employers.website, candidate.employer.website),
          ),
        )
        .limit(1);
      const employer =
        foundEmployer ??
        (
          await tx
            .insert(s.employers)
            .values({
              id: randomUUID(),
              ...candidate.employer,
              verificationStatus: env.APP_ENV === 'production' ? 'pending' : 'verified',
              isDemo: false,
            })
            .returning()
        )[0];
      const [foundJob] = await tx
        .select({ id: s.jobs.id })
        .from(s.jobs)
        .where(
          and(
            eq(s.jobs.employerId, employer.id),
            eq(s.jobs.applyUrl, candidate.feed.data.applyUrl!),
          ),
        )
        .limit(1);
      if (foundJob) {
        existing++;
        continue;
      }
      const data = candidate.feed.data;
      const descriptionText = plainText(data.descriptionHtml);
      await tx.insert(s.jobs).values({
        ...data,
        employerId: employer.id,
        descriptionText,
        slug: slugify(data.title),
        fingerprint: digest(
          [data.title, data.locationLabel, descriptionText, data.applyUrl ?? '']
            .map((value) => value.toLowerCase().replace(/\s+/g, ' ').trim())
            .join('|'),
        ),
        status: 'active',
        isDemo: false,
        originalPostedAt: data.originalPostedAt ? new Date(data.originalPostedAt) : null,
        expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
        firstDiscoveredAt: new Date(),
        lastVerifiedAt: new Date(),
        publishedAt: new Date(),
      });
      inserted++;
    }
  });
  return {
    fetched: items.length,
    ready: candidates.length,
    imported: inserted,
    existing,
    skipped: items.length - candidates.length,
  };
}

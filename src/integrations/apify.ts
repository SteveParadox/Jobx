import { readFileSync } from 'node:fs';
import countries from 'i18n-iso-countries';
import en from 'i18n-iso-countries/langs/en.json' with { type: 'json' };
import { eq } from 'drizzle-orm';
import { syncSource } from '../domain/ingestion';
import { sourceApproved } from '../domain/source-management';
import { getDb } from '../db';
import * as s from '../db/schema';
import { env } from '../lib/config';
import { digest, publicUrl, slugify } from '../lib/security';
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
  updated: number;
  awaitingApproval: number;
  quarantined: number;
  protected: number;
  skipped: number;
};
type Candidate = {
  feed: FeedJob;
  raw: Record<string, unknown>;
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
  const applyUrl = safeUrl(item.url);
  if (!applyUrl) return { skip: 'missing or unsafe application URL' };
  const title = text(item.title);
  if (!title) return { skip: 'missing title' };
  const description = text(item.description_html) || text(item.description);
  if (!description) return { skip: 'missing description' };
  const workplaceText = text(item.ai_work_arrangement).toLowerCase();
  const workplace = workplaceText.includes('hybrid')
    ? 'hybrid'
    : workplaceText.includes('remote')
      ? 'remote'
      : workplaceText.includes('on-site') || workplaceText.includes('onsite')
        ? 'onsite'
        : 'unknown';
  const expiresAt = isoDate(item.date_valid_through);
  const countryNames = list(item.countries_derived);
  const country = countryNames.map(countryFromName).find(Boolean);
  if (workplace !== 'remote' && !country)
    return { skip: 'missing normalized country for physical workplace' };
  // Derived job geography does not establish applicant-country eligibility.
  const remoteCountries: string[] = [];
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
      remoteEligibility: 'unknown',
      vacancyCount: number(item.ai_vacancies ?? item.vacancy_count),
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
  );
  if (!website) return { skip: 'missing employer website' };
  if (item.is_active === false || ['closed', 'expired'].includes(text(item.status).toLowerCase()))
    feed.linkStatus = 'gone';
  return {
    feed,
    raw: item,
    employer: {
      name,
      slug: apifyEmployerSlug(name, website),
      website,
      description: text(item.org_linkedin_description).slice(0, 10000),
      industry: text(item.org_linkedin_industry) || undefined,
      headquarters: text(item.org_linkedin_headquarters) || undefined,
      size: text(item.org_linkedin_size) || undefined,
      logoUrl: safeUrl(item.org_logo_permalink, item.organization_logo),
    },
  };
}
function checkedItems(input: unknown): Record<string, unknown>[] {
  if (!Array.isArray(input)) throw new Error('Expected an array of Apify dataset items');
  // Preserve invalid row counts, but never dereference null or non-object payloads.
  return input.map((item) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? (item as Record<string, unknown>)
      : {},
  );
}
async function fetchItems(options: ApifyImportOptions): Promise<Record<string, unknown>[]> {
  if (options.datasetFile)
    return checkedItems(JSON.parse(readFileSync(options.datasetFile, 'utf8')) as unknown);
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
    // Do not expose upstream error payloads: they can contain credentials or user data.
    throw new Error(`Apify request failed with HTTP ${response.status}`);
  const maxResponseBytes = 25 * 1024 * 1024;
  const length = Number(response.headers.get('content-length'));
  if (Number.isFinite(length) && length > maxResponseBytes)
    throw new Error('Apify dataset response exceeds the configured safety limit');
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Apify returned no response body');
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > maxResponseBytes) {
      await reader.cancel();
      throw new Error('Apify dataset response exceeds the configured safety limit');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return checkedItems(JSON.parse(new TextDecoder().decode(bytes)) as unknown);
}

/** The registration token is per actor and employer. It grants no approval by itself. */
export function apifyEmployerSlug(name: string, website: string) {
  return `${slugify(name).slice(0, 60)}-${digest(`${name}|${website}`).slice(0, 8)}`;
}
export function apifyBoardToken(actorId: string, employerSlug: string, employerWebsite: string) {
  return 'apify_' + digest([actorId.trim(), employerSlug, employerWebsite].join('|')).slice(0, 40);
}

export async function importApifyJobs(
  options: ApifyImportOptions = {},
): Promise<ApifyImportResult> {
  const logger = options.logger ?? (() => {});
  if (options.datasetFile && env.APP_ENV === 'production' && !options.dryRun)
    throw new Error('Local Apify dataset files cannot be persisted in production');
  const actorId = options.actorId?.trim() || env.APIFY_ACTOR_ID?.trim() || DEFAULT_ACTOR_ID;
  if (!options.datasetFile && !(options.token ?? process.env.APIFY_TOKEN?.trim()))
    throw new Error('APIFY_TOKEN is required (or set APIFY_DATASET_FILE)');
  // Scheduled runs must not invoke a paid actor without any approved integration.
  // Dry runs and local fixtures are explicitly review-only and may inspect candidates.
  if (!options.dryRun && !options.datasetFile) {
    const approved = await getDb()
      .select({ source: s.sources, employer: s.employers })
      .from(s.sources)
      .innerJoin(s.employers, eq(s.sources.employerId, s.employers.id))
      .where(eq(s.sources.provider, 'manual_apify'));
    if (!approved.some(({ source, employer }) =>
      source.enabled &&
      sourceApproved(source) &&
      source.boardToken ===
        apifyBoardToken(actorId, apifyEmployerSlug(employer.name, employer.website), employer.website) &&
      !employer.disabled &&
      employer.verificationStatus === 'verified'
    )) {
      logger('SKIP Apify actor execution: no enabled approved source for a verified employer');
      return {
        fetched: 0,
        ready: 0,
        imported: 0,
        updated: 0,
        existing: 0,
        awaitingApproval: 0,
        quarantined: 0,
        protected: 0,
        skipped: 0,
      };
    }
  }
  const items = await fetchItems({ ...options, actorId });
  const candidates: Candidate[] = [];
  for (const item of items) {
    const mapped = mapItem(item);
    if ('skip' in mapped) {
      logger('SKIP ' + (text(item.title) || '(untitled)') + ': ' + mapped.skip);
      continue;
    }
    candidates.push(mapped);
  }
  if (options.dryRun) {
    for (const candidate of candidates)
      logger(
        'READY ' + candidate.employer.name + ' | ' + candidate.feed.data.title +
        ' | source board token ' + apifyBoardToken(actorId, candidate.employer.slug, candidate.employer.website) +
        ' | registration and approval required',
      );
    return {
      fetched: items.length,
      ready: candidates.length,
      imported: 0,
      updated: 0,
      existing: 0,
      awaitingApproval: candidates.length,
      quarantined: 0,
      protected: 0,
      skipped: items.length - candidates.length,
    };
  }
  const db = getDb();
  const registered = await db
    .select({ source: s.sources, employer: s.employers })
    .from(s.sources)
    .innerJoin(s.employers, eq(s.sources.employerId, s.employers.id))
    .where(eq(s.sources.provider, 'manual_apify'));
  const byToken = new Map(registered.map((row) => [row.source.boardToken, row]));
  const batches = new Map<string, FeedJob[]>();
  let awaitingApproval = 0;
  for (const candidate of candidates) {
    const token = apifyBoardToken(actorId, candidate.employer.slug, candidate.employer.website);
    const registration = byToken.get(token);
    if (
      !registration ||
      registration.employer.website !== candidate.employer.website ||
      registration.employer.name !== candidate.employer.name ||
      registration.employer.disabled ||
      registration.employer.verificationStatus !== 'verified' ||
      !registration.source.enabled ||
      !sourceApproved(registration.source)
    ) {
      awaitingApproval++;
      logger('REVIEW ' + candidate.employer.name + ': no enabled, verified, approved Apify source for ' + token);
      continue;
    }
    const row: FeedJob = {
      ...candidate.feed,
      raw: candidate.raw,
      provenance: {
        provider: 'apify',
        actorId,
        originalJobUrl: candidate.feed.sourceUrl,
        observedAt: new Date().toISOString(),
      },
      fieldPresence: [
        'title',
        'descriptionHtml',
        'applyUrl',
        ...(Object.hasOwn(candidate.raw, 'ai_work_arrangement') ? ['workplace'] : []),
        ...(Object.hasOwn(candidate.raw, 'locations_derived') ||
        Object.hasOwn(candidate.raw, 'locations_alt') ||
        Object.hasOwn(candidate.raw, 'ai_remote_location')
          ? ['locationLabel']
          : []),
        ...(Object.hasOwn(candidate.raw, 'countries_derived') ? ['country'] : []),
        ...(Object.hasOwn(candidate.raw, 'regions_derived') ? ['region'] : []),
        ...(Object.hasOwn(candidate.raw, 'cities_derived') ? ['city'] : []),
        ...(Object.hasOwn(candidate.raw, 'date_posted') ? ['originalPostedAt'] : []),
        ...(Object.hasOwn(candidate.raw, 'date_valid_through') ? ['expiresAt'] : []),
        ...(candidate.feed.data.salaryMin != null ||
        (Object.hasOwn(candidate.raw, 'ai_salary_min_value') &&
          candidate.raw.ai_salary_min_value === null)
          ? ['salaryMin']
          : []),
        ...(candidate.feed.data.salaryMax != null ||
        (Object.hasOwn(candidate.raw, 'ai_salary_max_value') &&
          candidate.raw.ai_salary_max_value === null)
          ? ['salaryMax']
          : []),
        ...(candidate.feed.data.currency ||
        (Object.hasOwn(candidate.raw, 'ai_salary_currency') &&
          candidate.raw.ai_salary_currency === null)
          ? ['currency']
          : []),
        ...(candidate.feed.data.salaryPeriod ||
        (Object.hasOwn(candidate.raw, 'ai_salary_unit_text') &&
          candidate.raw.ai_salary_unit_text === null)
          ? ['salaryPeriod']
          : []),
        ...(Object.hasOwn(candidate.raw, 'ai_key_skills') ? ['skills'] : []),
        ...(Object.hasOwn(candidate.raw, 'ai_employment_type') ? ['employmentType'] : []),
        ...(Object.hasOwn(candidate.raw, 'ai_taxonomies_a') ||
        Object.hasOwn(candidate.raw, 'source')
          ? ['category']
          : []),
        ...(Object.hasOwn(candidate.raw, 'ai_experience_level')
          ? ['seniority', 'experienceMin']
          : []),
        ...(Object.hasOwn(candidate.raw, 'ai_education') ? ['education'] : []),
        ...(Object.hasOwn(candidate.raw, 'ai_visa_sponsorship')
          ? ['visaSponsorship']
          : []),
        ...(Object.hasOwn(candidate.raw, 'ai_vacancies') ||
        Object.hasOwn(candidate.raw, 'vacancy_count')
          ? ['vacancyCount']
          : []),
      ],
    };
    batches.set(registration.source.id, [...(batches.get(registration.source.id) ?? []), row]);
  }
  let imported = 0;
  let updated = 0;
  let existing = 0;
  let quarantined = 0;
  let protectedJobs = 0;
  for (const [sourceId, records] of batches) {
    // The actor query may be filtered, time-limited or incomplete. Never close absent jobs.
    const result = await syncSource(sourceId, fetch, records, {
      apifyActorId: actorId,
      suppressMissing: true,
    });
    imported += result.imported;
    updated += result.updated;
    quarantined += result.quarantined;
    protectedJobs += result.protected;
    // Rejected and protected rows are not successful existing-job refreshes.
    existing += Math.max(
      0,
      result.count - result.imported - result.quarantined - result.protected,
    );
    logger('SYNC ' + sourceId + ': ' + result.imported + ' created, ' + result.updated + ' updated, ' + result.quarantined + ' quarantined');
  }
  return {
    fetched: items.length,
    ready: candidates.length,
    imported,
    updated,
    existing,
    awaitingApproval,
    quarantined,
    protected: protectedJobs,
    skipped: items.length - candidates.length + awaitingApproval + quarantined + protectedJobs,
  };
}

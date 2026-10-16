import { jobSchema } from '@/domain/validation';
import { digest, escapeHtml, plainText, publicUrl, sanitizeDescription } from '@/lib/security';
import { z } from 'zod';
import { alpha3ToAlpha2, isValid } from 'i18n-iso-countries';
import { SourceError, type FeedJob, type Snapshot, type SourceContext } from './contracts';

const sourceJobSchema = z
  .object({
    ...jobSchema.shape,
    applicationMethod: z.literal('external'),
    resumeRequired: z.literal(false).default(false),
  })
  .superRefine((job, ctx) => {
    if (!job.applyUrl)
      ctx.addIssue({ code: 'custom', message: 'Authentic application URL is required' });
    if (plainText(job.descriptionHtml).length < 80)
      ctx.addIssue({ code: 'custom', message: 'Description is incomplete' });
    if ((job.salaryMin != null || job.salaryMax != null) && (!job.currency || !job.salaryPeriod))
      ctx.addIssue({ code: 'custom', message: 'Salary requires currency and interval' });
    if (job.salaryMin != null && job.salaryMax != null && job.salaryMin > job.salaryMax)
      ctx.addIssue({ code: 'custom', message: 'Contradictory salary range' });
    if (
      job.expiresAt &&
      job.originalPostedAt &&
      Date.parse(job.expiresAt) <= Date.parse(job.originalPostedAt)
    )
      ctx.addIssue({ code: 'custom', message: 'Closing date must follow original posting date' });
    if (job.originalPostedAt && Date.parse(job.originalPostedAt) > Date.now())
      ctx.addIssue({ code: 'custom', message: 'Original posting date is in the future' });
  });
export function readPath(value: unknown, path: string) {
  if (!path) return value;
  let current = value;
  const keys = path.split('.');
  if (
    keys.length > 10 ||
    keys.some((key) => ['__proto__', 'prototype', 'constructor'].includes(key))
  )
    throw new SourceError('FIELD_PATH', 'Unsafe or excessively deep field path');
  for (const key of keys) {
    if (!current || typeof current !== 'object' || !Object.hasOwn(current, key)) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}
export function canonicalApplicationUrl(value: string) {
  const url = new URL(publicUrl(value));
  for (const key of [...url.searchParams.keys()])
    if (/^(utm_|gclid$|fbclid$)/i.test(key)) url.searchParams.delete(key);
  url.searchParams.sort();
  return url.toString();
}
export function normalizedRecord(input: unknown, baseUrl?: string): FeedJob {
  const record = z.record(z.string(), z.unknown()).parse(input);
  const url = (v: unknown) => publicUrl(new URL(z.string().parse(v), baseUrl).toString());
  const sourceUrl = url(record.sourceUrl ?? record.applyUrl);
  const applyUrl = canonicalApplicationUrl(url(record.applyUrl));
  const country = countryCode(record.country);
  for (const key of ['salaryMin', 'salaryMax', 'experienceMin'])
    if (typeof record[key] === 'string' && /^\d+$/.test(record[key] as string))
      record[key] = Number(record[key]);
  for (const key of ['skills', 'remoteCountries'])
    if (typeof record[key] === 'string')
      record[key] = (record[key] as string)
        .split(';')
        .map((value) => value.trim())
        .filter(Boolean);
  if (
    typeof record.visaSponsorship === 'string' &&
    ['true', 'false'].includes(record.visaSponsorship)
  )
    record.visaSponsorship = record.visaSponsorship === 'true';
  if (Array.isArray(record.remoteCountries))
    record.remoteCountries = record.remoteCountries.map((value) => {
      const code = countryCode(value);
      if (!code) throw new SourceError('COUNTRY', 'Invalid explicit remote applicant country code');
      return code;
    });
  let description = sanitizeDescription(String(record.descriptionHtml ?? ''));
  for (const [key, heading] of [
    ['responsibilities', 'Responsibilities'],
    ['qualifications', 'Qualifications'],
    ['benefits', 'Benefits'],
  ]) {
    const value = record[key + 'Html'] ?? record[key];
    if (value === undefined || value === null || value === '') continue;
    const section =
      record[key + 'Html'] !== undefined
        ? sanitizeDescription(z.string().parse(value))
        : Array.isArray(value)
          ? '<ul>' +
            z
              .array(z.string())
              .max(100)
              .parse(value)
              .map((item) => '<li>' + escapeHtml(item) + '</li>')
              .join('') +
            '</ul>'
          : asHtml(z.string().parse(value));
    if (plainText(section) && !plainText(description).includes(plainText(section)))
      description += `<h3>${heading}</h3>${section}`;
  }
  const normalized = sourceJobSchema.parse({
    ...record,
    title: record.title,
    descriptionHtml: description,
    locationLabel: record.locationLabel || 'Location not specified',
    country,
    workplace: record.workplace ?? 'unknown',
    remoteCountries: record.remoteCountries ?? [],
    skills: record.skills ?? [],
    applicationMethod: 'external',
    resumeRequired: false,
    applyUrl,
  });
  if (
    /(?:pay|transfer|send).{0,30}(?:application|recruitment|registration).{0,15}(?:fee|payment)|(?:application|recruitment|registration) fee (?:is required|of |must)/i.test(
      plainText(normalized.descriptionHtml),
    )
  )
    throw new SourceError('SUSPICIOUS_FEES', 'Application-fee language requires manual review');
  return {
    externalId: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .parse(String(record.externalId ?? digest(sourceUrl))),
    sourceUrl,
    data: normalized,
    raw: input,
    sourcePostedAt:
      typeof record.sourcePostedAt === 'string' &&
      Number.isFinite(Date.parse(record.sourcePostedAt))
        ? new Date(record.sourcePostedAt).toISOString()
        : null,
  };
}
export function countryCode(value: unknown) {
  if (typeof value !== 'string') return undefined;
  const code = value.trim().toUpperCase();
  if (!/^[A-Z]{2,3}$/.test(code) || !isValid(code)) return undefined;
  return code.length === 3 ? alpha3ToAlpha2(code) : code;
}
export const asHtml = (text: unknown) => `<p>${escapeHtml(String(text ?? ''))}</p>`;
export function snapshotFromRows(
  rows: unknown[],
  normalize: (row: unknown) => FeedJob | null,
  requests = 0,
): Snapshot {
  const result: Snapshot = { records: [], rejected: [], complete: true, requests };
  const seen = new Set<string>();
  for (const raw of rows) {
    try {
      const row = normalize(raw);
      if (!row) {
        result.rejected.push({
          reason: 'EXCLUDED: source explicitly marks this listing as unlisted',
          raw,
        });
        continue;
      }
      if (seen.has(row.externalId))
        throw new SourceError('DUPLICATE_ID', 'Duplicate external ID in snapshot');
      seen.add(row.externalId);
      result.records.push(row);
    } catch (error) {
      result.complete = false;
      result.rejected.push({
        externalId:
          raw && typeof raw === 'object'
            ? String(
                (raw as Record<string, unknown>).id ??
                  (raw as Record<string, unknown>).externalId ??
                  '',
              ).slice(0, 200) || undefined
            : undefined,
        reason:
          error instanceof SourceError
            ? `${error.code}: ${error.message}`
            : 'MALFORMED_RECORD: required fields, URLs or normalized values are invalid',
        raw,
      });
    }
  }
  return result;
}
export function validateSnapshot(
  snapshot: Snapshot,
  ctx: Pick<SourceContext, 'source' | 'config'>,
): Snapshot {
  if (snapshot.records.length + snapshot.rejected.length > ctx.config.maxRecords)
    throw new SourceError('RECORD_LIMIT', 'Snapshot exceeds configured record limit');
  const validated = snapshotFromRows(
    snapshot.records,
    (value) => {
      const row = value as FeedJob;
      const normalized = normalizedRecord({
        ...row.data,
        externalId: row.externalId,
        sourceUrl: row.sourceUrl,
        sourcePostedAt: row.sourcePostedAt,
      });
      const host = new URL(normalized.data.applyUrl!).hostname;
      if (!ctx.source.applicationHostnames.includes(host))
        throw new SourceError(
          'APPLICATION_HOST',
          'Application destination hostname has not been approved',
        );
      const sourceHost = new URL(normalized.sourceUrl).hostname;
      if (
        sourceHost !== ctx.source.approvedHostname &&
        !ctx.source.applicationHostnames.includes(sourceHost)
      )
        throw new SourceError('SOURCE_HOST', 'Job-page attribution hostname has not been approved');
      return { ...normalized, raw: row.raw };
    },
    snapshot.requests,
  );
  return {
    ...validated,
    rejected: [...snapshot.rejected, ...validated.rejected],
    complete: snapshot.complete && validated.complete,
  };
}

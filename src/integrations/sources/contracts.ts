import type { sources } from '@/db/schema';
import type { JobInput } from '@/domain/validation';
import { z } from 'zod';

export type Source = typeof sources.$inferSelect;
export type FeedJob = {
  externalId: string;
  sourceUrl: string;
  data: JobInput;
  raw: unknown;
  sourcePostedAt?: string | null;
  linkStatus?: 'reachable' | 'gone' | 'unavailable';
};
export type RejectedRecord = { externalId?: string; reason: string; raw?: unknown };
export type Snapshot = {
  records: FeedJob[];
  rejected: RejectedRecord[];
  complete: boolean;
  requests: number;
};
export class SourceError extends Error {
  constructor(
    public code: string,
    message: string,
    public retryable = false,
    public retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'SourceError';
  }
}
export const sourceConfigSchema = z
  .object({
    maxPages: z.number().int().min(1).max(100).default(20),
    pageSize: z.number().int().min(1).max(100).default(100),
    maxRequests: z.number().int().min(1).max(200).default(50),
    maxRecords: z.number().int().min(1).max(10000).default(5000),
    maxBytes: z.number().int().min(1000).max(10000000).default(5000000),
    timeoutMs: z.number().int().min(1000).max(20000).default(15000),
    requestsPerMinute: z.number().int().min(1).max(120).default(20),
    robots: z.boolean().default(true),
    browserPermitted: z.boolean().default(false),
    checkApplicationLinks: z.boolean().default(false),
    applicationFetchPermitted: z.boolean().default(false),
    credentialEnv: z
      .string()
      .regex(/^JOB_SOURCE_TOKEN_[A-Z0-9_]{1,80}$/)
      .optional(),
    recordsPath: z.string().max(200).default('jobs'),
    nextPath: z.string().max(200).optional(),
    completePath: z.string().max(200).optional(),
    pageParameter: z
      .string()
      .regex(/^[A-Za-z_]{1,40}$/)
      .optional(),
    emptyMeansComplete: z.boolean().default(false),
    fullCatalog: z.boolean().default(false),
    itemSelector: z.string().min(1).max(200).default('[data-job-id]'),
    titleSelector: z.string().min(1).max(200).default('h2'),
    descriptionSelector: z.string().min(1).max(200).default('.description'),
    locationSelector: z.string().min(1).max(200).default('.location'),
    applySelector: z.string().min(1).max(200).default('a.apply'),
    idAttribute: z
      .string()
      .regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,60}$/)
      .default('data-job-id'),
    nextSelector: z.string().max(200).optional(),
    detailSelector: z.string().max(200).optional(),
    emptySelector: z.string().max(200).optional(),
    waitForSelector: z.string().max(200).optional(),
    // Exact employer-approved location overrides; never infer country from free-text.
    locationOverrides: z.record(
      z.string().min(1).max(250),
      z.object({
        country: z.string().regex(/^[A-Z]{2}$/).optional(),
        region: z.string().max(150).optional(),
        city: z.string().max(150).optional(),
        workplace: z.enum(['onsite', 'hybrid', 'remote']),
        remoteCountries: z.array(z.string().regex(/^[A-Z]{2}$/)).max(100).default([]),
      }).refine((v) => v.workplace === 'remote' ? v.remoteCountries.length > 0 : Boolean(v.country),
        'Location override needs physical country or explicit remote eligibility'),
    ).default({}),
    fieldMap: z.preprocess(
      (value) => {
        if (
          value &&
          typeof value === 'object' &&
          ['__proto__', 'prototype', 'constructor'].some((key) => Object.hasOwn(value, key))
        )
          throw new SourceError('FIELD_PATH', 'Prototype keys are not permitted in field mappings');
        return value;
      },
      z
        .record(z.string(), z.string().max(200))
        .refine(
          (value) =>
            Object.keys(value).every((key) =>
              [
                'externalId',
                'sourceUrl',
                'applyUrl',
                'title',
                'descriptionHtml',
                'responsibilities',
                'qualifications',
                'benefits',
                'responsibilitiesHtml',
                'qualificationsHtml',
                'benefitsHtml',
                'locationLabel',
                'country',
                'region',
                'city',
                'workplace',
                'remoteCountries',
                'skills',
                'employmentType',
                'category',
                'seniority',
                'experienceMin',
                'education',
                'visaSponsorship',
                'salaryMin',
                'salaryMax',
                'currency',
                'salaryPeriod',
                'originalPostedAt',
                'expiresAt',
              ].includes(key),
            ),
          'Only normalized job fields can be mapped',
        )
        .default({}),
    ),
  })
  .strict();
export type SourceConfig = z.infer<typeof sourceConfigSchema>;
export type SourceResponse = { url: string; status: number; headers: Headers; body: string };
export type SourceContext = {
  source: Source;
  config: SourceConfig;
  signal: AbortSignal;
  request: (
    url: string,
    types: string[],
    options?: { robots?: boolean; allowMissing?: boolean; credential?: boolean },
  ) => Promise<SourceResponse>;
  checkCancelled: () => Promise<void>;
  requestCount: () => number;
};
export interface SourceAdapter {
  provider: string;
  discover: (source: Pick<Source, 'boardToken' | 'endpointUrl'>) => string;
  fetch: (context: SourceContext) => Promise<Snapshot>;
}
export const ATS_PROVIDERS = ['greenhouse', 'lever', 'lever_eu', 'ashby'] as const;
export const NETWORK_PROVIDERS = [
  ...ATS_PROVIDERS,
  'authorized_json',
  'authorized_xml',
  'authorized_rss',
  'authorized_html',
  'authorized_browser',
  'licensed_json',
] as const;
export const MANUAL_PROVIDERS = ['manual_json', 'manual_csv', 'manual_xml'] as const;
export const JSON_TYPES = ['application/json', 'text/json'];
export const XML_TYPES = [
  'application/xml',
  'text/xml',
  'application/rss+xml',
  'application/atom+xml',
];
export const HTML_TYPES = ['text/html', 'application/xhtml+xml'];

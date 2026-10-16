import {
  ATS_PROVIDERS,
  MANUAL_PROVIDERS,
  NETWORK_PROVIDERS,
  sourceConfigSchema,
} from '@/integrations/sources/contracts';
import { publicUrl } from '@/lib/security';
import { z } from 'zod';
const https = z
  .string()
  .max(2000)
  .transform((v) => publicUrl(v));
const optionalText = (max = 200) => z.string().trim().max(max).optional();
export const workplace = z.enum(['remote', 'hybrid', 'onsite', 'unknown']);
export const employment = z.enum([
  'FULL_TIME',
  'PART_TIME',
  'CONTRACTOR',
  'TEMPORARY',
  'INTERN',
  'VOLUNTEER',
  'PER_DIEM',
  'OTHER',
]);
export const searchSchema = z
  .object({
    q: z.string().trim().max(160).default(''),
    country: optionalText(2),
    region: optionalText(),
    city: optionalText(),
    workplace: workplace.optional(),
    eligibleCountry: optionalText(2),
    category: optionalText(),
    industry: optionalText(),
    company: z.uuid().optional(),
    seniority: optionalText(),
    employmentType: employment.optional(),
    education: optionalText(),
    experienceMax: z.coerce.number().int().min(0).max(60).optional(),
    visa: z.enum(['true', 'false']).optional(),
    salaryMin: z.coerce.number().int().min(0).max(100000000).optional(),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .optional(),
    salaryPeriod: z.enum(['HOUR', 'DAY', 'WEEK', 'MONTH', 'YEAR']).optional(),
    days: z.coerce.number().int().min(1).max(365).optional(),
    sort: z.enum(['relevance', 'recent', 'salary']).default('relevance'),
    page: z.coerce.number().int().min(1).max(1000).default(1),
  })
  .superRefine((v, c) => {
    if ((v.salaryMin !== undefined || v.sort === 'salary') && (!v.currency || !v.salaryPeriod))
      c.addIssue({
        code: 'custom',
        message: 'Salary search requires both currency and salary period',
        path: ['currency'],
      });
  });
export type SearchFilters = z.infer<typeof searchSchema>;
export const jobSchema = z
  .object({
    title: z.string().trim().min(3).max(180),
    descriptionHtml: z.string().min(80).max(100000),
    locationLabel: z.string().trim().min(2).max(200),
    country: z
      .string()
      .regex(/^[A-Z]{2}$/)
      .nullable()
      .optional(),
    region: optionalText(),
    city: optionalText(),
    workplace: workplace.default('unknown'),
    remoteCountries: z
      .array(z.string().regex(/^[A-Z]{2}$/))
      .max(250)
      .default([]),
    employmentType: employment.nullable().optional(),
    category: optionalText(),
    seniority: optionalText(),
    skills: z.array(z.string().trim().min(1).max(60)).max(50).default([]),
    experienceMin: z.number().int().min(0).max(60).nullable().optional(),
    education: optionalText(),
    visaSponsorship: z.boolean().nullable().optional(),
    salaryMin: z.number().int().min(0).max(100000000).nullable().optional(),
    salaryMax: z.number().int().min(0).max(100000000).nullable().optional(),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .nullable()
      .optional(),
    salaryPeriod: z.enum(['HOUR', 'DAY', 'WEEK', 'MONTH', 'YEAR']).nullable().optional(),
    applicationMethod: z.enum(['external', 'native']).default('external'),
    resumeRequired: z.boolean().default(false),
    applyUrl: https.nullable().optional(),
    originalPostedAt: z.iso.datetime().nullable().optional(),
    expiresAt: z.iso.datetime().nullable().optional(),
  })
  .superRefine((v, c) => {
    if (v.applicationMethod === 'external' && !v.applyUrl)
      c.addIssue({
        code: 'custom',
        message: 'External applications need an HTTPS destination',
        path: ['applyUrl'],
      });
    if (v.workplace === 'remote' && v.remoteCountries.length === 0)
      c.addIssue({
        code: 'custom',
        message: 'Specify permitted applicant countries for fully remote work',
        path: ['remoteCountries'],
      });
    if (v.workplace !== 'remote' && !v.country)
      c.addIssue({
        code: 'custom',
        message: 'Country is required for physical workplaces',
        path: ['country'],
      });
    if ((v.salaryMin != null || v.salaryMax != null) && (!v.currency || !v.salaryPeriod))
      c.addIssue({
        code: 'custom',
        message: 'Disclosed salary requires currency and period',
        path: ['currency'],
      });
    if (v.salaryMin != null && v.salaryMax != null && v.salaryMin > v.salaryMax)
      c.addIssue({
        code: 'custom',
        message: 'Minimum salary exceeds maximum',
        path: ['salaryMin'],
      });
    if (v.expiresAt && v.originalPostedAt && new Date(v.expiresAt) <= new Date(v.originalPostedAt))
      c.addIssue({
        code: 'custom',
        message: 'Deadline must follow posting date',
        path: ['expiresAt'],
      });
  });
export type JobInput = z.infer<typeof jobSchema>;
export const employerSchema = z.object({
  name: z.string().trim().min(2).max(160),
  website: https,
  description: z.string().trim().max(10000).default(''),
  industry: optionalText(),
  headquarters: optionalText(),
  size: optionalText(),
});
export const alertSchema = z.object({
  name: z.string().trim().min(2).max(100),
  filters: searchSchema,
  frequency: z.enum(['daily', 'weekly']),
  channel: z.enum(['email', 'in_app']),
  consent: z.literal(true),
});
export const alertUpdateSchema = alertSchema
  .omit({ consent: true })
  .partial()
  .extend({ enabled: z.boolean().optional(), consent: z.literal(true).optional() })
  .refine((v) => Object.keys(v).some((key) => key !== 'consent'), 'Choose a field to update');
export const candidatePreferencesSchema = z.object({
  emailAlertsEnabled: z.boolean(),
  searchHistoryEnabled: z.boolean(),
});
export const savedSearchSchema = z.object({
  name: z.string().trim().min(2).max(100),
  filters: searchSchema,
});
export const sourceSchema = z
  .object({
    employerId: z.uuid(),
    provider: z
      .string()
      .max(80)
      .refine(
        (value) =>
          [...NETWORK_PROVIDERS, ...MANUAL_PROVIDERS].includes(
            value as (typeof NETWORK_PROVIDERS)[number],
          ) || /^licensed_[a-z0-9_]+$/.test(value),
        'Unsupported source provider',
      ),
    boardToken: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/),
    permissionEvidence: z.string().trim().min(20).max(10000),
    attribution: z.string().trim().min(2).max(500),
    permittedFields: z
      .array(
        z.enum([
          'title',
          'description',
          'location',
          'application',
          'date',
          'salary',
          'skills',
          'employment',
          'experience',
        ]),
      )
      .min(1),
    removalPolicy: z.string().min(10).max(2000),
    intervalMinutes: z.number().int().min(15).max(10080),
    autoPublish: z.boolean().default(false),
    enabled: z.literal(false).default(false),
    endpointUrl: https.optional(),
    applicationHostnames: z.array(z.string().trim().toLowerCase().min(3).max(250)).min(1).max(20),
    usageConditions: z.string().trim().min(10).max(5000),
    authorizationExpiresAt: z.iso.datetime().nullable().optional(),
    missingConfirmations: z.number().int().min(2).max(10).default(2),
    missingGraceMinutes: z.number().int().min(15).max(10080).default(60),
    config: sourceConfigSchema.default(sourceConfigSchema.parse({})),
  })
  .superRefine((source, ctx) => {
    if (
      !source.provider.startsWith('manual_') &&
      !ATS_PROVIDERS.includes(source.provider as (typeof ATS_PROVIDERS)[number]) &&
      !source.endpointUrl
    )
      ctx.addIssue({
        code: 'custom',
        message: 'An employer-approved HTTPS endpoint is required',
        path: ['endpointUrl'],
      });
    if (source.provider.startsWith('authorized_') && !source.config.robots)
      ctx.addIssue({
        code: 'custom',
        message: 'Employer page/feed adapters must check robots.txt',
        path: ['config'],
      });
    if (source.provider === 'authorized_browser' && !source.config.browserPermitted)
      ctx.addIssue({
        code: 'custom',
        message: 'Explicit browser-execution permission is required',
        path: ['config'],
      });
    if (source.config.checkApplicationLinks && !source.config.applicationFetchPermitted)
      ctx.addIssue({
        code: 'custom',
        message: 'Application-link checking requires explicit fetch permission',
        path: ['config'],
      });
  });

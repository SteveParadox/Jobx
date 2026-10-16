import { jobSchema } from '@/domain/validation';
import { publicUrl } from '@/lib/security';
import { parse } from 'csv-parse/sync';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { z } from 'zod';
import type { FeedJob } from './feeds';
export function parseAuthorizedImport(format: 'json' | 'csv' | 'xml', content: string): FeedJob[] {
  if (Buffer.byteLength(content) > 180000) throw new Error('Import exceeds 180 KB limit');
  let records: unknown;
  if (format === 'json') records = JSON.parse(content);
  else if (format === 'csv')
    records = parse(content, {
      columns: true,
      skip_empty_lines: true,
      bom: true,
      max_record_size: 100000,
    });
  else {
    if (/<!DOCTYPE|<!ENTITY/i.test(content))
      throw new Error('XML document types and entities are not permitted');
    if (XMLValidator.validate(content) !== true) throw new Error('Malformed XML');
    const parsed = new XMLParser({
      ignoreAttributes: true,
      processEntities: false,
      parseTagValue: false,
      isArray: (tag) => tag === 'job',
    }).parse(content);
    records = parsed.jobs?.job ?? [];
  }
  return z
    .array(z.record(z.string(), z.unknown()))
    .max(1000)
    .parse(records)
    .map((record) => {
      const normalized: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(record))
        if (value !== '' && value !== null) normalized[key] = value;
      for (const key of ['salaryMin', 'salaryMax', 'experienceMin'])
        if (normalized[key] !== undefined) normalized[key] = Number(normalized[key]);
      for (const key of ['skills', 'remoteCountries'])
        if (typeof normalized[key] === 'string')
          normalized[key] = (normalized[key] as string)
            .split(';')
            .map((v) => v.trim())
            .filter(Boolean);
      if (typeof normalized.visaSponsorship === 'string') {
        if (!['true', 'false'].includes(normalized.visaSponsorship))
          throw new Error('Invalid sponsorship boolean');
        normalized.visaSponsorship = normalized.visaSponsorship === 'true';
      }
      const externalId = z
        .string()
        .min(1)
        .max(200)
        .parse(String(normalized.externalId ?? ''));
      const sourceUrl = publicUrl(z.string().parse(normalized.sourceUrl));
      return {
        externalId,
        sourceUrl,
        data: jobSchema.parse({ ...normalized, applicationMethod: 'external' }),
        raw: record,
      };
    });
}

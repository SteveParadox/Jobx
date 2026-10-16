import type { JobInput } from '@/domain/validation';
import { plainText, publicUrl, sanitizeDescription } from '@/lib/security';
import { decode } from 'he';
import { z } from 'zod';
export type FeedJob = { externalId: string; sourceUrl: string; data: JobInput; raw: unknown };
const greenhouse = z.object({
  id: z.number().int(),
  title: z.string(),
  absolute_url: z.string(),
  content: z.string().optional(),
  location: z.object({ name: z.string() }),
  first_published: z.string().nullable().optional(),
});
const lever = z.object({
  id: z.string(),
  text: z.string(),
  hostedUrl: z.string(),
  applyUrl: z.string(),
  description: z.string(),
  descriptionPlain: z.string().optional(),
  categories: z
    .object({ location: z.string().optional(), commitment: z.string().optional() })
    .optional(),
  lists: z.array(z.object({ text: z.string(), content: z.string() })).optional(),
  additional: z.string().optional(),
  createdAt: z.number().optional(),
});
// Location labels stay verbatim. Countries, remote eligibility and compensation remain unknown
// until a human or a source's explicit structured fields establish them.
export function parseGreenhouse(payload: unknown): FeedJob[] {
  const root = z.object({ jobs: z.array(greenhouse) }).parse(payload);
  return root.jobs.map((row) => ({
    externalId: String(row.id),
    sourceUrl: publicUrl(row.absolute_url),
    raw: row,
    data: {
      title: row.title,
      descriptionHtml: sanitizeDescription(decode(row.content ?? '')),
      locationLabel: row.location.name,
      workplace: 'unknown',
      remoteCountries: [],
      skills: [],
      applicationMethod: 'external',
      resumeRequired: false,
      applyUrl: publicUrl(row.absolute_url),
      originalPostedAt:
        row.first_published && Number.isFinite(Date.parse(row.first_published))
          ? new Date(row.first_published).toISOString()
          : null,
    },
  }));
}
export function parseLever(payload: unknown): FeedJob[] {
  return z
    .array(lever)
    .parse(payload)
    .map((row) => ({
      externalId: row.id,
      sourceUrl: publicUrl(row.hostedUrl),
      raw: row,
      data: {
        title: row.text,
        descriptionHtml: sanitizeDescription(
          [
            row.description,
            ...(row.lists ?? []).map((v) => `<h3>${plainText(v.text)}</h3>${v.content}`),
            row.additional ?? '',
          ].join('\n'),
        ),
        locationLabel: row.categories?.location ?? 'Location not specified',
        workplace: 'unknown',
        remoteCountries: [],
        skills: [],
        applicationMethod: 'external',
        resumeRequired: false,
        applyUrl: publicUrl(row.applyUrl),
        originalPostedAt:
          row.createdAt && Number.isFinite(new Date(row.createdAt).getTime())
            ? new Date(row.createdAt).toISOString()
            : null,
      },
    }));
}
export function feedUrl(provider: string, boardToken: string, offset = 0) {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(boardToken)) throw new Error('Invalid board identifier');
  switch (provider) {
    case 'greenhouse':
      return `https://boards-api.greenhouse.io/v1/boards/${boardToken}/jobs?content=true`;
    case 'lever':
      return `https://api.lever.co/v0/postings/${boardToken}?mode=json&limit=100&skip=${offset}`;
    case 'lever_eu':
      return `https://api.eu.lever.co/v0/postings/${boardToken}?mode=json&limit=100&skip=${offset}`;
    default:
      throw new Error('Unsupported source provider');
  }
}
async function boundedJson(response: Response) {
  if (!response.ok) throw new Error(`Source HTTP ${response.status}`);
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Empty source response');
  let total = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > 10 * 1024 * 1024) {
      await reader.cancel();
      throw new Error('Source response exceeds 10 MB limit');
    }
    chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}
export async function fetchFeed(
  provider: string,
  boardToken: string,
  fetcher: typeof fetch = fetch,
) {
  const rows: FeedJob[] = [];
  for (let page = 0; page < 100; page++) {
    const response = await fetcher(feedUrl(provider, boardToken, page * 100), {
      redirect: 'error',
      signal: AbortSignal.timeout(20000),
      headers: {
        Accept: 'application/json',
        'User-Agent': 'CareerAtlas authorized job synchronizer',
      },
    });
    const payload = await boundedJson(response);
    const batch = provider === 'greenhouse' ? parseGreenhouse(payload) : parseLever(payload);
    rows.push(...batch);
    if (provider === 'greenhouse' || batch.length < 100) return rows;
  }
  throw new Error('Pagination safety limit reached; refusing incomplete snapshot');
}

import { load } from 'cheerio';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { decode } from 'he';
import { z } from 'zod';
import { feedUrl, parseGreenhouse, parseLever } from '../feeds';
import {
  HTML_TYPES,
  JSON_TYPES,
  SourceError,
  XML_TYPES,
  type Snapshot,
  type SourceAdapter,
  type SourceContext,
} from './contracts';
import { normalizedRecord, readPath, snapshotFromRows } from './normalize';

function json(body: string) {
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new SourceError('MALFORMED_JSON', 'Source returned malformed JSON');
  }
}
function xml(body: string) {
  if (/<!DOCTYPE|<!ENTITY/i.test(body) || XMLValidator.validate(body) !== true)
    throw new SourceError('MALFORMED_XML', 'Invalid XML or forbidden document/entity declaration');
  return new XMLParser({
    ignoreAttributes: false,
    processEntities: false,
    parseTagValue: false,
    isArray: (tag) => ['job', 'item', 'entry', 'link'].includes(tag),
  }).parse(body);
}
function merge(target: Snapshot, page: Snapshot) {
  target.records.push(...page.records);
  target.rejected.push(...page.rejected);
  target.complete &&= page.complete;
}
function checkedRows(value: unknown) {
  if (!Array.isArray(value))
    throw new SourceError('ENVELOPE', 'Expected an explicit array of source records');
  return value;
}
export const atsAdapters: SourceAdapter[] = ['greenhouse', 'lever', 'lever_eu', 'ashby'].map(
  (provider) => ({
    provider,
    discover: (source) =>
      provider === 'ashby'
        ? `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(source.boardToken)}?includeCompensation=true`
        : feedUrl(provider, source.boardToken),
    fetch: async (ctx) => {
      const snapshot: Snapshot = { records: [], rejected: [], complete: true, requests: 0 };
      const seenPages = new Set<string>();
      for (let page = 0; page < ctx.config.maxPages; page++) {
        const url = new URL(ctx.source.endpointUrl!);
        if (provider.startsWith('lever')) {
          url.searchParams.set('skip', String(page * ctx.config.pageSize));
          url.searchParams.set('limit', String(ctx.config.pageSize));
        }
        const response = await ctx.request(url.toString(), JSON_TYPES);
        const payload = json(response.body);
        const rows = checkedRows(
          provider.startsWith('lever') ? payload : readPath(payload, 'jobs'),
        );
        const pageKey = JSON.stringify(rows);
        if (rows.length && seenPages.has(pageKey))
          throw new SourceError('REPEATED_PAGE', 'Pagination returned a repeated page');
        seenPages.add(pageKey);
        merge(
          snapshot,
          snapshotFromRows(rows, (row) => {
            if (provider === 'greenhouse') {
              const parsed = parseGreenhouse({ jobs: [row] })[0];
              const override = ctx.config.locationOverrides[parsed.data.locationLabel];
              return override ? { ...parsed, data: { ...parsed.data, ...override } } : parsed;
            }
            if (provider.startsWith('lever')) return parseLever([row])[0];
            return normalizeAshby(row);
          }),
        );
        if (!provider.startsWith('lever') || rows.length < ctx.config.pageSize) {
          snapshot.requests = ctx.requestCount();
          return snapshot;
        }
      }
      throw new SourceError(
        'PAGINATION_LIMIT',
        'Pagination limit reached; no complete snapshot established',
      );
    },
  }),
);
export function normalizeAshby(value: unknown) {
  const row = z
    .object({
      title: z.string(),
      jobUrl: z.string(),
      applyUrl: z.string(),
      descriptionHtml: z.string(),
      location: z.string().optional(),
      id: z.string().optional(),
      isListed: z.boolean(),
      workplaceType: z.enum(['Remote', 'Hybrid', 'OnSite']).optional(),
      employmentType: z.string().optional(),
      publishedAt: z.string().optional(),
      address: z
        .object({
          postalAddress: z
            .object({
              addressLocality: z.string().optional(),
              addressRegion: z.string().optional(),
              addressCountry: z.string().optional(),
            })
            .optional(),
        })
        .optional(),
      compensation: z
        .object({
          summaryComponents: z
            .array(
              z.object({
                compensationType: z.string(),
                interval: z.string(),
                currencyCode: z.string().nullable(),
                minValue: z.number().nullable(),
                maxValue: z.number().nullable(),
              }),
            )
            .optional(),
        })
        .optional(),
    })
    .parse(value);
  if (!row.isListed) return null;
  const address = row.address?.postalAddress;
  const salaries =
    row.compensation?.summaryComponents?.filter((item) => item.compensationType === 'Salary') ?? [];
  const salary = salaries.length === 1 ? salaries[0] : undefined;
  const periods: Record<string, string> = {
    '1 HOUR': 'HOUR',
    '1 DAY': 'DAY',
    '1 WEEK': 'WEEK',
    '1 MONTH': 'MONTH',
    '1 YEAR': 'YEAR',
  };
  const usableSalary =
    salary &&
    periods[salary.interval] &&
    /^[A-Z]{3}$/.test(salary.currencyCode ?? '') &&
    [salary.minValue, salary.maxValue].filter((v) => v !== null).every((v) => Number.isInteger(v));
  const types: Record<string, string> = {
    FullTime: 'FULL_TIME',
    PartTime: 'PART_TIME',
    Intern: 'INTERN',
    Contract: 'CONTRACTOR',
    Temporary: 'TEMPORARY',
  };
  return {
    ...normalizedRecord({
      externalId: row.id,
      sourceUrl: row.jobUrl,
      applyUrl: row.applyUrl,
      title: row.title,
      descriptionHtml: row.descriptionHtml,
      locationLabel: row.location,
      country: address?.addressCountry,
      city: address?.addressLocality,
      region: address?.addressRegion,
      workplace:
        ({ Remote: 'remote', Hybrid: 'hybrid', OnSite: 'onsite' } as Record<string, string>)[
          row.workplaceType ?? ''
        ] ?? 'unknown',
      employmentType: types[row.employmentType ?? ''],
      // publishedAt is documented as last publication, not the original posting date.
      sourcePostedAt: row.publishedAt,
      ...(usableSalary
        ? {
            salaryMin: salary.minValue,
            salaryMax: salary.maxValue,
            currency: salary.currencyCode,
            salaryPeriod: periods[salary.interval],
          }
        : {}),
    }),
    raw: value,
  };
}
function authorizedRecord(value: unknown, ctx: SourceContext, base: string) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new SourceError('MALFORMED_RECORD', 'Expected an object');
  const record = { ...(value as Record<string, unknown>) };
  for (const [key, path] of Object.entries(ctx.config.fieldMap))
    record[key] = readPath(value, path);
  return normalizedRecord(record, base);
}
async function fetchStructured(ctx: SourceContext, format: 'json' | 'xml'): Promise<Snapshot> {
  const result: Snapshot = { records: [], rejected: [], complete: true, requests: 0 };
  let next: string | undefined = ctx.source.endpointUrl!;
  const seen = new Set<string>();
  for (let page = 0; next && page < ctx.config.maxPages; page++) {
    if (seen.has(next)) throw new SourceError('REPEATED_PAGE', 'Pagination cycle detected');
    seen.add(next);
    const response = await ctx.request(next, format === 'json' ? JSON_TYPES : XML_TYPES);
    const payload = format === 'json' ? json(response.body) : xml(response.body);
    if (ctx.config.completePath && readPath(payload, ctx.config.completePath) !== true)
      result.complete = false;
    if (
      !ctx.config.nextPath &&
      (readPath(payload, 'hasMore') === true || readPath(payload, 'has_more') === true)
    )
      throw new SourceError(
        'PARTIAL_FEED',
        'Source indicates more pages but no next-page mapping is configured',
      );
    let recordList = readPath(payload, ctx.config.recordsPath);
    if (recordList === undefined && format === 'xml' && ctx.config.emptyMeansComplete) {
      const parent = readPath(payload, ctx.config.recordsPath.split('.').slice(0, -1).join('.'));
      if (parent === '' || (parent && typeof parent === 'object' && !Object.keys(parent).length))
        recordList = [];
    }
    const rows = checkedRows(recordList);
    merge(
      result,
      snapshotFromRows(rows, (row) => authorizedRecord(row, ctx, response.url)),
    );
    if (!rows.length && page === 0 && !ctx.config.emptyMeansComplete)
      throw new SourceError('EMPTY_UNCONFIRMED', 'Explicit empty-feed confirmation is required');
    if (ctx.config.nextPath) {
      const value = readPath(payload, ctx.config.nextPath);
      if (value !== null && value !== undefined && value !== '' && typeof value !== 'string')
        throw new SourceError('NEXT_PAGE', 'Invalid next-page URL');
      next = value ? new URL(String(value), response.url).toString() : undefined;
    } else if (ctx.config.pageParameter && rows.length) {
      const url = new URL(ctx.source.endpointUrl!);
      url.searchParams.set(ctx.config.pageParameter, String(page + 2));
      next = url.toString();
    } else next = undefined;
  }
  if (next)
    throw new SourceError('PAGINATION_LIMIT', 'Structured feed is incomplete at page limit');
  result.requests = ctx.requestCount();
  return result;
}
async function fetchRss(ctx: SourceContext) {
  const response = await ctx.request(ctx.source.endpointUrl!, XML_TYPES);
  const root = xml(response.body);
  const rss = root.rss?.channel;
  const atom = root.feed;
  if (!rss && !atom) throw new SourceError('ENVELOPE', 'Expected RSS channel or Atom feed');
  const rows = checkedRows(rss ? (rss.item ?? []) : (atom.entry ?? []));
  const result = snapshotFromRows(
    rows,
    (value) => {
      const row = value as Record<string, unknown>;
      const links = Array.isArray(row.link) ? row.link : [row.link];
      const link = atom
        ? links.find((v) => v?.['@_rel'] === 'alternate' || !v?.['@_rel'])?.['@_href']
        : links[0];
      const description =
        row['content:encoded'] ??
        row.description ??
        (row.content as Record<string, unknown>)?.['#text'] ??
        row.summary;
      const custom: Record<string, unknown> = {
        externalId:
          typeof row.guid === 'object'
            ? (row.guid as Record<string, unknown>)['#text']
            : (row.guid ?? row.id),
        sourceUrl: link,
        applyUrl: link,
        title: row.title,
        descriptionHtml: decode(String(description ?? '')),
        sourcePostedAt: row.pubDate ?? row.published,
        locationLabel: row.location,
      };
      for (const [key, path] of Object.entries(ctx.config.fieldMap))
        custom[key] = readPath(row, path);
      return normalizedRecord(custom, response.url);
    },
    ctx.requestCount(),
  );
  // RSS/Atom commonly expose only a recent window. Reconciliation must be opted into
  // only when the approved source contract guarantees a complete active catalog.
  result.complete &&= ctx.config.fullCatalog;
  return result;
}
export function parseHtmlPage(body: string, url: string, ctx: SourceContext) {
  const $ = load(body);
  if (
    /noindex|nofollow|noarchive|nosnippet/i.test(
      $('meta[name="robots"]')
        .map((_, tag) => $(tag).attr('content') ?? '')
        .get()
        .join(','),
    )
  )
    throw new SourceError('PAGE_ROBOTS', 'Page robots metadata prohibits collection');
  const items = $(ctx.config.itemSelector).toArray();
  if (!items.length && !(ctx.config.emptySelector && $(ctx.config.emptySelector).length))
    throw new SourceError('HTML_SHAPE', 'Job selectors disappeared or empty state is unconfirmed');
  const rows = items.map((item) => {
    const node = $(item);
    return {
      externalId: node.attr(ctx.config.idAttribute),
      title: node.find(ctx.config.titleSelector).text().trim(),
      descriptionHtml: node.find(ctx.config.descriptionSelector).html() ?? '',
      locationLabel: node.find(ctx.config.locationSelector).text().trim(),
      applyUrl: node.find(ctx.config.applySelector).attr('href'),
      detailUrl: ctx.config.detailSelector
        ? node.find(ctx.config.detailSelector).attr('href')
        : undefined,
    };
  });
  return {
    rows,
    next: ctx.config.nextSelector ? $(ctx.config.nextSelector).first().attr('href') : undefined,
  };
}
async function fetchHtml(ctx: SourceContext) {
  const result: Snapshot = { records: [], rejected: [], complete: true, requests: 0 };
  let next: string | undefined = ctx.source.endpointUrl!;
  const seen = new Set<string>();
  for (let page = 0; next && page < ctx.config.maxPages; page++) {
    if (seen.has(next)) throw new SourceError('REPEATED_PAGE', 'HTML pagination cycle detected');
    seen.add(next);
    const response = await ctx.request(next, HTML_TYPES);
    if (
      /noindex|nofollow|noarchive|nosnippet|noai/i.test(response.headers.get('x-robots-tag') ?? '')
    )
      throw new SourceError('PAGE_ROBOTS', 'Source response robots policy prohibits collection');
    const parsed = parseHtmlPage(response.body, response.url, ctx);
    for (const row of parsed.rows) {
      let record: Record<string, unknown> = row;
      if (row.detailUrl) {
        const detail = await ctx.request(
          new URL(row.detailUrl, response.url).toString(),
          HTML_TYPES,
        );
        const $ = load(detail.body);
        if (
          /noindex|nofollow|noarchive|nosnippet/i.test(
            $('meta[name="robots"]')
              .map((_, tag) => $(tag).attr('content') ?? '')
              .get()
              .join(','),
          ) ||
          /noindex|nofollow|noarchive|nosnippet/i.test(detail.headers.get('x-robots-tag') ?? '')
        )
          throw new SourceError('PAGE_ROBOTS', 'Detail page prohibits collection');
        record = {
          ...row,
          descriptionHtml: $(ctx.config.descriptionSelector).first().html() ?? '',
          sourceUrl: detail.url,
        };
      }
      merge(
        result,
        snapshotFromRows([record], (r) =>
          normalizedRecord(
            {
              sourceUrl: (record as Record<string, unknown>).sourceUrl ?? row.applyUrl,
              ...(r as object),
            },
            response.url,
          ),
        ),
      );
    }
    next = parsed.next ? new URL(parsed.next, response.url).toString() : undefined;
  }
  if (next) throw new SourceError('PAGINATION_LIMIT', 'HTML catalog is incomplete at page limit');
  result.requests = ctx.requestCount();
  return result;
}
const custom: SourceAdapter[] = [
  ...['authorized_json', 'licensed_json'].map((provider) => ({
    provider,
    discover: (source: { endpointUrl: string | null }) => source.endpointUrl ?? '',
    fetch: (ctx: SourceContext) => fetchStructured(ctx, 'json'),
  })),
  {
    provider: 'authorized_xml',
    discover: (source) => source.endpointUrl ?? '',
    fetch: (ctx) => fetchStructured(ctx, 'xml'),
  },
  { provider: 'authorized_rss', discover: (source) => source.endpointUrl ?? '', fetch: fetchRss },
  { provider: 'authorized_html', discover: (source) => source.endpointUrl ?? '', fetch: fetchHtml },
  {
    provider: 'authorized_browser',
    discover: (source) => source.endpointUrl ?? '',
    fetch: async (ctx) => (await import('./browser')).fetchBrowser(ctx),
  },
];
const registry = new Map([...atsAdapters, ...custom].map((adapter) => [adapter.provider, adapter]));
export function sourceAdapter(provider: string) {
  const adapter = registry.get(provider);
  if (!adapter) throw new SourceError('PROVIDER', 'Unsupported source adapter');
  return adapter;
}
// Extensions are trusted application code, never uploaded JavaScript or admin-supplied eval.
export function registerLicensedAdapter(adapter: SourceAdapter) {
  if (!adapter.provider.startsWith('licensed_') || registry.has(adapter.provider))
    throw new SourceError('PROVIDER', 'Licensed adapter must have a unique licensed_ identifier');
  registry.set(adapter.provider, adapter);
}

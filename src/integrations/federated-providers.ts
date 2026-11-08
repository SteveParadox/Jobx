/**
 * Fixed-host, opt-in job-search API adapters.
 *
 * These are ephemeral external leads, not published Jobx jobs. Never send user
 * profiles, resumes, account identifiers, or credentials to a result URL.
 * API keys are sent only to hard-coded provider hosts.
 */
export type ProviderId = 'jobx' | 'himalayas' | 'adzuna' | 'usajobs' | 'jooble';
export type SearchLead = {
  id: string;
  provider: ProviderId;
  providerName: string;
  title: string;
  company: string;
  location: string;
  url: string;
  excerpt: string;
  postedAt: string | null;
  expiresAt?: string | null;
  provenance: 'published_catalog' | 'external_api';
  attributionUrl: string | null;
  attributionLogoUrl: string | null;
};
export type ExternalSearch = {
  q: string;
  location: string;
  page: number;
  market?: string;
};
export type JsonFetch = typeof fetch;

const MAX_BODY_BYTES = 1_800_000;
const MAX_RESULTS = 15;
const HIMALAYAS_PAGE_SIZE = 20;
export const ADZUNA_MARKET_DOMAINS: Record<string, string> = {
  us: 'adzuna.com',
  gb: 'adzuna.co.uk',
  au: 'adzuna.com.au',
  ca: 'adzuna.ca',
  de: 'adzuna.de',
  fr: 'adzuna.fr',
  nl: 'adzuna.nl',
  be: 'adzuna.be',
  at: 'adzuna.at',
  ch: 'adzuna.ch',
  it: 'adzuna.it',
  es: 'adzuna.es',
  pl: 'adzuna.pl',
  in: 'adzuna.in',
  sg: 'adzuna.sg',
  nz: 'adzuna.co.nz',
  za: 'adzuna.co.za',
  br: 'adzuna.com.br',
  mx: 'adzuna.com.mx',
};

const obj = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const rows = (value: unknown, max = MAX_RESULTS): unknown[] =>
  Array.isArray(value) ? value.slice(0, max) : [];
const txt = (value: unknown, limit = 240): string =>
  typeof value === 'string' ? value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit) : '';
const date = (value: unknown): string | null => {
  // Himalayas returns Unix seconds; some older fixtures use milliseconds.
  const millis = typeof value === 'number'
    ? (value > 0 && value < 100_000_000_000 ? value * 1000 : value)
    : typeof value === 'string' && value.trim()
      ? Date.parse(value.trim())
      : NaN;
  return Number.isFinite(millis) && millis >= 0 && millis <= 8.64e15
    ? new Date(millis).toISOString()
    : null;
};
const validId = (value: unknown, url: string) =>
  typeof value === 'string' || typeof value === 'number'
    ? String(value).slice(0, 180)
    : url;
export function safeProviderUrl(value: unknown, allowedHost: string): string | null {
  if (
    typeof value !== 'string' ||
    value.length > 3000 ||
    !value.trim() ||
    value !== value.trim() ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) return null;
  try {
    const url = new URL(value);
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.port ||
      !(url.hostname === allowedHost || url.hostname.endsWith('.' + allowedHost))
    )
      return null;
    // Partner tracking and application links must remain unchanged.
    return value;
  } catch {
    return null;
  }
}
function lead(
  provider: Exclude<ProviderId, 'jobx'>,
  providerName: string,
  id: unknown,
  title: unknown,
  company: unknown,
  location: unknown,
  link: unknown,
  excerpt: unknown,
  postedAt: unknown,
  allowedHost: string,
  attributionUrl: string,
  attributionLogoUrl: string | null = null,
): SearchLead | null {
  const url = safeProviderUrl(link, allowedHost);
  const safeTitle = txt(title, 180);
  if (!url || safeTitle.length < 3) return null;
  return {
    id: provider + ':' + validId(id, url),
    provider,
    providerName,
    title: safeTitle,
    company: txt(company, 160) || 'Employer not disclosed',
    location: txt(location, 200) || 'Location not disclosed',
    url,
    excerpt: txt(excerpt, 360),
    postedAt: date(postedAt),
    provenance: 'external_api',
    attributionUrl,
    attributionLogoUrl,
  };
}
export function parseAdzuna(
  payload: unknown,
  market: string,
  logoUrl: string,
): SearchLead[] {
  const domain = ADZUNA_MARKET_DOMAINS[market];
  if (!domain) return [];
  const homepage = 'https://www.' + domain;
  return rows(obj(payload).results)
    .map((raw) => {
      const job = obj(raw);
      return lead(
        'adzuna',
        'Adzuna',
        job.id,
        job.title,
        obj(job.company).display_name,
        obj(job.location).display_name,
        job.redirect_url,
        job.description,
        job.created,
        domain,
        homepage,
        logoUrl,
      );
    })
    .filter((job): job is SearchLead => job !== null);
}
export function parseUsaJobs(payload: unknown): SearchLead[] {
  return rows(obj(obj(payload).SearchResult).SearchResultItems)
    .map((raw) => {
      const row = obj(raw);
      const job = obj(row.MatchedObjectDescriptor);
      return lead(
        'usajobs',
        'USAJOBS',
        row.MatchedObjectId ?? job.PositionID,
        job.PositionTitle,
        job.OrganizationName,
        job.PositionLocationDisplay,
        job.PositionURI,
        job.QualificationSummary,
        job.PublicationStartDate ?? job.PositionStartDate,
        'usajobs.gov',
        'https://www.usajobs.gov',
      );
    })
    .filter((job): job is SearchLead => job !== null);
}
export function parseHimalayas(payload: unknown, now = Date.now()): SearchLead[] {
  return rows(obj(payload).jobs, HIMALAYAS_PAGE_SIZE)
    .map((raw) => {
      const job = obj(raw);
      const expiry = date(job.expiryDate);
      if (expiry && Date.parse(expiry) <= now) return null;
      const item = lead(
        'himalayas',
        'Himalayas',
        job.guid,
        job.title,
        job.companyName,
        'Remote · check country and timezone restrictions at the source',
        job.applicationLink,
        job.excerpt,
        job.pubDate,
        'himalayas.app',
        'https://himalayas.app',
      );
      return item ? { ...item, expiresAt: expiry } : null;
    })
    .filter((job): job is SearchLead => job !== null);
}
export function parseJooble(payload: unknown): SearchLead[] {
  return rows(obj(payload).jobs)
    .map((raw) => {
      const job = obj(raw);
      return lead(
        'jooble',
        'Jooble',
        job.id,
        job.title,
        job.company,
        job.location,
        job.link,
        job.snippet,
        job.updated,
        'jooble.org',
        'https://jooble.org',
      );
    })
    .filter((job): job is SearchLead => job !== null);
}
async function requestJson(
  url: URL,
  init: RequestInit,
  request: JsonFetch,
): Promise<unknown> {
  const host = url.hostname;
  // Prevent accidental credential transmission to arbitrary URLs.
  if (
    url.protocol !== 'https:' ||
    !(
      host === 'api.adzuna.com' ||
      host === 'data.usajobs.gov' ||
      host === 'himalayas.app' ||
      host === 'jooble.org' ||
      /^[a-z]{2}\.jooble\.org$/.test(host)
    )
  )
    throw new Error('UNAPPROVED_PROVIDER_HOST');
  const response = await request(url.toString(), {
    ...init,
    redirect: 'error',
    cache: 'no-store',
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error('UPSTREAM_UNAVAILABLE');
  const length = Number(response.headers.get('content-length') ?? '0');
  if (length > MAX_BODY_BYTES) throw new Error('UPSTREAM_TOO_LARGE');
  const media = response.headers.get('content-type') ?? '';
  if (media && !/(^|\/)json|\+json/i.test(media)) throw new Error('UPSTREAM_CONTENT_TYPE');
  const reader = response.body?.getReader();
  if (!reader) throw new Error('UPSTREAM_EMPTY');
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > MAX_BODY_BYTES) throw new Error('UPSTREAM_TOO_LARGE');
      chunks.push(part.value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  const buffer = new Uint8Array(bytes);
  let offset = 0;
  for (const part of chunks) {
    buffer.set(part, offset);
    offset += part.length;
  }
  try {
    return JSON.parse(new TextDecoder().decode(buffer)) as unknown;
  } catch {
    throw new Error('UPSTREAM_JSON_INVALID');
  }
}
export async function fetchAdzuna(
  query: ExternalSearch,
  credentials: { appId: string; appKey: string; logoUrl: string },
  markets: string[],
  request: JsonFetch = fetch,
): Promise<SearchLead[]> {
  const result: SearchLead[] = [];
  for (const market of markets.slice(0, 2)) {
    if (!Object.hasOwn(ADZUNA_MARKET_DOMAINS, market)) continue;
    const url = new URL('https://api.adzuna.com/v1/api/jobs/' + market + '/search/' + query.page);
    url.searchParams.set('app_id', credentials.appId);
    url.searchParams.set('app_key', credentials.appKey);
    url.searchParams.set('results_per_page', '15');
    url.searchParams.set('what', query.q);
    if (query.location) url.searchParams.set('where', query.location);
    const payload = await requestJson(url, { method: 'GET', headers: { Accept: 'application/json' } }, request);
    if (!Array.isArray(obj(payload).results)) throw new Error('UPSTREAM_ENVELOPE');
    result.push(...parseAdzuna(payload, market, credentials.logoUrl));
  }
  return result;
}
export async function fetchUsaJobs(
  query: ExternalSearch,
  credentials: { apiKey: string; email: string },
  remoteOnly: boolean,
  request: JsonFetch = fetch,
): Promise<SearchLead[]> {
  const url = new URL('https://data.usajobs.gov/api/search');
  url.searchParams.set('Keyword', query.q);
  url.searchParams.set('Page', String(query.page));
  url.searchParams.set('ResultsPerPage', '15');
  if (query.location) url.searchParams.set('LocationName', query.location);
  if (remoteOnly) url.searchParams.set('RemoteIndicator', 'True');
  const payload = await requestJson(
    url,
    {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'Authorization-Key': credentials.apiKey,
        'User-Agent': credentials.email,
      },
    },
    request,
  );
  if (!Array.isArray(obj(obj(payload).SearchResult).SearchResultItems))
    throw new Error('UPSTREAM_ENVELOPE');
  return parseUsaJobs(payload);
}
export async function fetchHimalayas(
  query: { q: string; page: number; country?: string },
  request: JsonFetch = fetch,
): Promise<SearchLead[]> {
  const url = new URL('https://himalayas.app/jobs/api/search');
  url.searchParams.set('q', query.q);
  url.searchParams.set('page', String(query.page));
  if (query.country) url.searchParams.set('country', query.country);
  const payload = await requestJson(
    url,
    { method: 'GET', headers: { Accept: 'application/json' } },
    request,
  );
  if (!Array.isArray(obj(payload).jobs)) throw new Error('UPSTREAM_ENVELOPE');
  return parseHimalayas(payload);
}
export async function fetchJooble(
  query: ExternalSearch,
  credentials: { apiKey: string; region: string },
  request: JsonFetch = fetch,
): Promise<SearchLead[]> {
  if (!/^[a-z]{2}$/.test(credentials.region)) throw new Error('JOOBLE_REGION_INVALID');
  const regionalCode = credentials.region === 'gb' ? 'uk' : credentials.region;
  const hostname = regionalCode === 'us' ? 'jooble.org' : regionalCode + '.jooble.org';
  const url = new URL('https://' + hostname + '/api/' + encodeURIComponent(credentials.apiKey));
  const payload = await requestJson(
    url,
    {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        keywords: query.q,
        location: query.location,
        page: query.page,
        ResultOnPage: 15,
      }),
    },
    request,
  );
  if (!Array.isArray(obj(payload).jobs)) throw new Error('UPSTREAM_ENVELOPE');
  return parseJooble(payload);
}
/** Revalidate internal Redis data before any cached link reaches the browser. */
export function cachedHimalayas(value: unknown, now = Date.now()): SearchLead[] | null {
  if (!Array.isArray(value) || value.length > HIMALAYAS_PAGE_SIZE) return null;
  const accepted: SearchLead[] = [];
  for (const raw of value) {
    const item = obj(raw);
    if (
      item.provider !== 'himalayas' ||
      item.providerName !== 'Himalayas' ||
      item.provenance !== 'external_api' ||
      item.attributionUrl !== 'https://himalayas.app' ||
      item.attributionLogoUrl !== null ||
      typeof item.id !== 'string' ||
      typeof item.title !== 'string' ||
      typeof item.company !== 'string' ||
      typeof item.location !== 'string' ||
      typeof item.excerpt !== 'string' ||
      typeof item.url !== 'string' ||
      safeProviderUrl(item.url, 'himalayas.app') !== item.url ||
      (item.postedAt !== null && typeof item.postedAt !== 'string') ||
      (item.expiresAt !== null &&
        item.expiresAt !== undefined &&
        typeof item.expiresAt !== 'string')
    ) return null;
    if (item.expiresAt !== null && item.expiresAt !== undefined) {
      const expires = Date.parse(item.expiresAt as string);
      if (!Number.isFinite(expires)) return null;
      if (expires <= now) continue;
    }
    accepted.push({
      id: item.id,
      provider: 'himalayas',
      providerName: 'Himalayas',
      title: item.title,
      company: item.company,
      location: item.location,
      url: item.url,
      excerpt: item.excerpt,
      postedAt: item.postedAt as string | null,
      expiresAt: (item.expiresAt as string | null | undefined) ?? null,
      provenance: 'external_api',
      attributionUrl: 'https://himalayas.app',
      attributionLogoUrl: null,
    });
  }
  return accepted;
}
export function uniqueLeads(leads: SearchLead[], max = 60): SearchLead[] {
  const seen = new Set<string>();
  const result: SearchLead[] = [];
  for (const item of leads) {
    const key = item.url;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
    if (result.length >= max) break;
  }
  return result;
}

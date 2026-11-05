import { getDb } from '@/db';
import * as s from '@/db/schema';
import { sql } from 'drizzle-orm';
import type { IncomingHttpHeaders } from 'node:http';
import { load } from 'cheerio';
import robotsParser from 'robots-parser';
import { delay, secureTransport } from '@/integrations/sources/http';
import {
  candidateFromUrl,
  detectAts,
  resolveSameHostLink,
  type SourceCandidate,
} from './source-classifier';

const MAX_BYTES = 1_000_000;
const TIMEOUT_MS = 6_000;
const MAX_REDIRECTS = 3;
const MAX_PAGES_PER_SEED = 3;
const MAX_SITEMAPS_PER_SEED = 1;
const MIN_HOST_INTERVAL_MS = 1000;

/**
 * Reserve a per-host request slot in PostgreSQL so independent worker processes
 * share the same crawl budget. The upsert serializes concurrent reservations.
 */
export async function reserveHostRequestSlot(hostname: string, now = new Date()): Promise<Date> {
  const [reservation] = await getDb()
    .insert(s.sourceHostBudgets)
    .values({ hostname, nextRequestAt: now })
    .onConflictDoUpdate({
      target: s.sourceHostBudgets.hostname,
      set: {
        nextRequestAt: sql`GREATEST(
          ${s.sourceHostBudgets.nextRequestAt},
          ${now}
        ) + (${MIN_HOST_INTERVAL_MS} * INTERVAL '1 millisecond')`,
      },
    })
    .returning({ nextRequestAt: s.sourceHostBudgets.nextRequestAt });
  if (!reservation) throw new Error('Could not reserve a discovery request slot');
  return reservation.nextRequestAt;
}

/** Retain server-directed cooldowns across retries, runs and independent workers. */
export async function deferHostRequests(hostname: string, notBefore: Date): Promise<void> {
  await getDb()
    .insert(s.sourceHostBudgets)
    .values({ hostname, nextRequestAt: notBefore })
    .onConflictDoUpdate({
      target: s.sourceHostBudgets.hostname,
      set: {
        nextRequestAt: sql`GREATEST(${s.sourceHostBudgets.nextRequestAt}, ${notBefore})`,
      },
    });
}

function retryAfterMilliseconds(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const ms = /^\d+$/.test(value) ? Number(value) * 1000 : Date.parse(value) - Date.now();
  return Number.isFinite(ms) && Number.isFinite(new Date(Date.now() + ms).getTime())
    ? Math.max(0, ms)
    : undefined;
}

const USER_AGENT = 'CareerAtlasSourceDiscovery/1.0';

type SafeResponse = { url: URL; status: number; headers: IncomingHttpHeaders; body: string };

async function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  let cancel = () => {};
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        cancel = () => reject(signal.reason);
        signal.addEventListener('abort', cancel, { once: true });
      }),
    ]);
  } finally {
    signal.removeEventListener('abort', cancel);
  }
}

/** Reuse the ingestion transport: bounded DNS, vetted lookup, no pooled socket reuse. */
async function requestPinned(url: URL, parentSignal: AbortSignal): Promise<SafeResponse> {
  const signal = AbortSignal.any([parentSignal, AbortSignal.timeout(TIMEOUT_MS)]);
  const nextRequestAt = await abortable(reserveHostRequestSlot(url.hostname), signal);
  await delay(Math.max(0, nextRequestAt.getTime() - Date.now()), signal);
  const response = await secureTransport(url.toString(), {
    signal,
    maxBytes: MAX_BYTES,
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'text/html,application/xml,text/xml,text/plain;q=0.9',
      'Accept-Encoding': 'identity',
    },
  });
  const cooldown = retryAfterMilliseconds(response.headers.get('retry-after') ?? undefined);
  if (cooldown !== undefined && (response.status === 429 || response.status >= 500)) {
    await abortable(deferHostRequests(url.hostname, new Date(Date.now() + cooldown)), signal);
  }
  return {
    url,
    status: response.status,
    headers: Object.fromEntries(response.headers),
    body: response.body,
  };
}

const MAX_REQUEST_ATTEMPTS = 3;
const MAX_RETRY_DELAY_MS = 5000;

function transientNetworkFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.name === 'TimeoutError') return true;
  const code = 'code' in error ? String(error.code) : '';
  return (
    [
      'EAI_AGAIN',
      'ECONNRESET',
      'ETIMEDOUT',
      'ECONNREFUSED',
      'EHOSTUNREACH',
      'ENETUNREACH',
    ].includes(code) || /request timed out|exceeded its total time budget/i.test(error.message)
  );
}

function retryDelay(response: SafeResponse | undefined, attempt: number): number | null {
  const header = response?.headers['retry-after'];
  const value = Array.isArray(header) ? header[0] : header;
  const minimum = retryAfterMilliseconds(value) ?? 0;
  // Never turn a long server-directed cooldown into an early retry.
  if (minimum > MAX_RETRY_DELAY_MS) return null;
  return Math.min(MAX_RETRY_DELAY_MS, Math.max(minimum, 250 * 2 ** attempt) + Math.random() * 250);
}

export async function requestWithRetry(
  url: URL,
  requester: (url: URL) => Promise<SafeResponse> = (target) => requestPinned(target, signal),
  sleep: (ms: number) => Promise<void> = (ms) => delay(ms, signal),
  signal: AbortSignal = AbortSignal.timeout(60_000),
): Promise<SafeResponse> {
  for (let attempt = 0; attempt < MAX_REQUEST_ATTEMPTS; attempt++) {
    signal.throwIfAborted();
    let response: SafeResponse | undefined;
    try {
      response = await abortable(requester(url), signal);
      const retryableStatus =
        response.status === 429 || [500, 502, 503, 504].includes(response.status);
      if (!retryableStatus || attempt === MAX_REQUEST_ATTEMPTS - 1) return response;
    } catch (error) {
      if (!transientNetworkFailure(error) || attempt === MAX_REQUEST_ATTEMPTS - 1) throw error;
    }
    const wait = retryDelay(response, attempt);
    if (wait === null && response) return response;
    await abortable(sleep(wait ?? 0), signal);
  }
  throw new Error('Discovery request retry limit exceeded');
}

async function safeGet(
  input: URL,
  expectedHostname: string,
  signal: AbortSignal,
  allowed: (url: URL) => boolean = () => true,
): Promise<SafeResponse> {
  let current = new URL(input);
  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect++) {
    if (
      current.protocol !== 'https:' ||
      current.username ||
      current.password ||
      (current.port && current.port !== '443')
    )
      throw new Error('Unsafe URL or redirect rejected');
    if (!allowed(current)) throw new Error('Discovery URL is disallowed by robots.txt');
    const response = await requestWithRetry(current, undefined, undefined, signal);
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.location;
    if (!location) throw new Error('Redirect did not include a location');
    if (redirect === MAX_REDIRECTS) throw new Error('Redirect limit exceeded');
    const next = new URL(location, current);
    if (next.hostname.toLowerCase() !== expectedHostname.toLowerCase())
      throw new Error('Cross-host redirects are not followed during discovery');
    if (next.protocol !== 'https:' || next.username || next.password)
      throw new Error('Unsafe redirect target rejected');
    current = next;
  }
  throw new Error('Redirect limit exceeded');
}

export function isCandidatePath(url: URL): boolean {
  return /(?:career|jobs?|openings?|vacanc|recruit|work-with-us|join-us|positions?)/i.test(
    url.pathname,
  );
}

function allowedByRobots(robotsUrl: string, content: string, target: URL): boolean {
  try {
    return robotsParser(robotsUrl, content).isAllowed(target.toString(), USER_AGENT) !== false;
  } catch {
    return false;
  }
}

export function locationsFromSitemap(xml: string, base: URL): URL[] {
  const $ = load(xml, { xml: true });
  const found: URL[] = [];
  $('loc').each((_index, element) => {
    const raw = $(element).text().trim();
    if (!raw || found.length >= 500) return;
    try {
      const url = new URL(raw);
      if (
        url.protocol === 'https:' &&
        url.hostname === base.hostname &&
        !url.username &&
        !url.password &&
        !url.port
      )
        found.push(url);
    } catch {
      /* Ignore malformed sitemap entries. */
    }
  });
  return found;
}

/**
 * Fetches only a small same-host set of career pages/sitemaps. All fetched URLs
 * pass DNS pinning, public-IP checks, HTTPS-only redirect validation, byte and
 * time limits, and robots policy. External ATS links are surfaced as candidates
 * but are not fetched during the employer-host crawl.
 */
export async function crawlCareerSeed(
  seedInput: string,
  now = new Date(),
  parentSignal?: AbortSignal,
): Promise<SourceCandidate[]> {
  const signal = AbortSignal.any([
    AbortSignal.timeout(60_000),
    ...(parentSignal ? [parentSignal] : []),
  ]);
  const seed = new URL(seedInput);
  if (
    seed.protocol !== 'https:' ||
    seed.username ||
    seed.password ||
    (seed.port && seed.port !== '443')
  )
    throw new Error('Only credential-free standard-port HTTPS seeds are accepted');
  const candidates = new Map<string, SourceCandidate>();
  const add = (
    input: string,
    kind: 'seed_domain' | 'career_link' | 'sitemap_url' | 'ats_pattern',
  ) => {
    try {
      const candidate = candidateFromUrl(input, kind, now.toISOString());
      if (!candidates.has(candidate.canonicalUrl))
        candidates.set(candidate.canonicalUrl, candidate);
    } catch {
      /* An invalid page link must not discard other valid candidates. */
    }
  };
  // Validate the seed strictly; page links are individually discardable.
  candidateFromUrl(seed.toString(), 'seed_domain', now.toISOString());
  add(seed.toString(), 'seed_domain');

  const robotsUrl = new URL('/robots.txt', seed.origin);
  let robotsText = '';
  try {
    const robots = await safeGet(robotsUrl, seed.hostname, signal);
    if (robots.status >= 200 && robots.status < 300) robotsText = robots.body;
    else if (robots.status !== 404 && robots.status !== 410)
      throw new Error('robots.txt could not be checked safely');
  } catch (error) {
    throw new Error(
      'Could not safely retrieve robots.txt: ' +
        (error instanceof Error ? error.message : 'request failed'),
    );
  }

  const sitemapUrls = new Set<string>();
  const robotsLines = robotsText.split(/\r?\n/);
  for (const line of robotsLines) {
    const match = /^\s*sitemap:\s*(\S+)/i.exec(line);
    if (!match || sitemapUrls.size >= MAX_SITEMAPS_PER_SEED) continue;
    try {
      const sitemap = new URL(match[1]);
      if (
        sitemap.protocol === 'https:' &&
        sitemap.hostname === seed.hostname &&
        !sitemap.username &&
        !sitemap.password &&
        !sitemap.port
      )
        sitemapUrls.add(sitemap.toString());
    } catch {
      /* Ignore malformed sitemap directives. */
    }
  }

  if (!sitemapUrls.size) sitemapUrls.add(new URL('/sitemap.xml', seed.origin).toString());
  const allowed = (url: URL) => allowedByRobots(robotsUrl.toString(), robotsText, url);
  const queue = [seed];
  const seenPages = new Set<string>();
  while (queue.length && seenPages.size < MAX_PAGES_PER_SEED) {
    signal.throwIfAborted();
    const target = queue.shift()!;
    if (seenPages.has(target.toString())) continue;
    seenPages.add(target.toString());
    if (
      target.hostname !== seed.hostname ||
      !allowedByRobots(robotsUrl.toString(), robotsText, target)
    )
      continue;
    let response: SafeResponse;
    try {
      response = await safeGet(target, seed.hostname, signal, allowed);
    } catch {
      continue;
    }
    if (response.status < 200 || response.status >= 300) continue;
    const type = String(response.headers['content-type'] ?? '').toLowerCase();
    if (!type.includes('html') && !/\.(?:html?|xhtml)(?:$|\?)/i.test(target.pathname)) continue;
    const $ = load(response.body);
    $('a[href]').each((_index, element) => {
      if (candidates.size >= 250) return;
      const href = $(element).attr('href');
      if (!href) return;
      let resolved: URL;
      try {
        resolved = new URL(href, response.url);
      } catch {
        return;
      }
      if (detectAts(resolved.toString())) {
        add(resolved.toString(), 'ats_pattern');
        return;
      }
      const sameHost = resolveSameHostLink(response.url.toString(), href);
      if (!sameHost) return;
      const url = new URL(sameHost);
      if (!isCandidatePath(url)) return;
      add(sameHost, 'career_link');
      if (queue.length + seenPages.size < MAX_PAGES_PER_SEED) queue.push(url);
    });
  }

  let sitemapCount = 0;
  for (const sitemapString of sitemapUrls) {
    if (sitemapCount++ >= MAX_SITEMAPS_PER_SEED || candidates.size >= 250) break;
    signal.throwIfAborted();
    const sitemapUrl = new URL(sitemapString);
    if (!allowedByRobots(robotsUrl.toString(), robotsText, sitemapUrl)) continue;
    try {
      const response = await safeGet(sitemapUrl, seed.hostname, signal, allowed);
      if (response.status < 200 || response.status >= 300) continue;
      const locations = locationsFromSitemap(response.body, seed);
      for (const url of locations) {
        if (!isCandidatePath(url)) continue;
        add(url.toString(), 'sitemap_url');
        if (candidates.size >= 250) break;
      }
    } catch {
      /* A failed sitemap does not invalidate candidates from other paths. */
    }
  }
  signal.throwIfAborted();
  return [...candidates.values()];
}

import { lookup } from 'node:dns/promises';
import { getDb } from '@/db';
import * as s from '@/db/schema';
import { sql } from 'drizzle-orm';
import { request } from 'node:https';
import type { IncomingHttpHeaders } from 'node:http';
import type { LookupFunction } from 'node:dns';
import { load } from 'cheerio';
import ipaddr from 'ipaddr.js';
import robotsParser from 'robots-parser';
import { candidateFromUrl, detectAts, resolveSameHostLink, type SourceCandidate } from './source-classifier';

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
export async function reserveHostRequestSlot(
  hostname: string,
  now = new Date(),
): Promise<Date> {
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

async function waitForHostBudget(hostname: string): Promise<void> {
  const now = new Date();
  const nextRequestAt = await reserveHostRequestSlot(hostname, now);
  const delay = nextRequestAt.getTime() - now.getTime();
  if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
}
const USER_AGENT = 'CareerAtlasSourceDiscovery/1.0';

type SafeResponse = { url: URL; status: number; headers: IncomingHttpHeaders; body: string };

function publicAddress(address: string): boolean {
  try {
    return ipaddr.process(address).range() === 'unicast';
  } catch {
    return false;
  }
}

/** HTTPS request whose socket lookup is pinned to an address checked immediately before connect. */
async function requestPinned(url: URL, maxBytes = MAX_BYTES): Promise<SafeResponse> {
  await waitForHostBudget(url.hostname);
  const answers = await lookup(url.hostname, { all: true, verbatim: true });
  if (!answers.length || answers.some((answer) => !publicAddress(answer.address)))
    throw new Error('DNS resolved to an address outside the public unicast range');
  const selected = answers[0];
  return await new Promise((resolve, reject) => {
    let settled = false;
    let deadline: NodeJS.Timeout | undefined;
    const finishError = (error: Error) => {
      if (settled) return;
      settled = true;
      if (deadline) clearTimeout(deadline);
      reject(error);
    };
    const req = request(url, {
      method: 'GET',
      headers: { 'user-agent': USER_AGENT, accept: 'text/html,application/xml,text/xml,text/plain;q=0.9,*/*;q=0.1' },
      lookup: ((_hostname, _options, callback) => {
        callback(null, selected.address, selected.family);
      }) as LookupFunction,
    }, (res) => {
      const chunks: Buffer[] = [];
      let size = 0;
      res.on('data', (chunk: Buffer | string) => {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += buffer.length;
        if (size > maxBytes) {
          req.destroy(new Error('Response exceeded discovery byte limit'));
          return;
        }
        chunks.push(buffer);
      });
      res.on('error', finishError);
      res.on('end', () => {
        if (settled) return;
        settled = true;
        if (deadline) clearTimeout(deadline);
        resolve({
          url,
          status: res.statusCode ?? 0,
          headers: res.headers,
          body: Buffer.concat(chunks).toString('utf8'),
        });
      });
    });
    req.setTimeout(TIMEOUT_MS, () => req.destroy(new Error('Discovery request timed out')));
    deadline = setTimeout(() => req.destroy(new Error('Discovery request exceeded its total time budget')), TIMEOUT_MS);
    req.on('error', finishError);
    req.end();
  });
}

const MAX_REQUEST_ATTEMPTS = 3;
const MAX_RETRY_DELAY_MS = 5000;

function transientNetworkFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = 'code' in error ? String(error.code) : '';
  return (
    ['EAI_AGAIN', 'ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH'].includes(code) ||
    /request timed out|exceeded its total time budget/i.test(error.message)
  );
}

function retryDelay(response: SafeResponse | undefined, attempt: number): number {
  const header = response?.headers['retry-after'];
  const value = Array.isArray(header) ? header[0] : header;
  let requested = 250 * 2 ** attempt;
  if (value) {
    const seconds = Number(value);
    const retryAt = Date.parse(value);
    if (Number.isFinite(seconds) && seconds >= 0) requested = seconds * 1000;
    else if (Number.isFinite(retryAt)) requested = Math.max(0, retryAt - Date.now());
  }
  // Bound server-provided delays and add jitter so independent workers do not
  // all retry the same host at the same instant.
  return Math.min(MAX_RETRY_DELAY_MS, Math.max(0, requested)) * (0.75 + Math.random() * 0.5);
}

async function requestWithRetry(url: URL): Promise<SafeResponse> {
  for (let attempt = 0; attempt < MAX_REQUEST_ATTEMPTS; attempt++) {
    let response: SafeResponse | undefined;
    try {
      response = await requestPinned(url);
      const retryableStatus = response.status === 429 || [500, 502, 503, 504].includes(response.status);
      if (!retryableStatus || attempt === MAX_REQUEST_ATTEMPTS - 1) return response;
    } catch (error) {
      if (!transientNetworkFailure(error) || attempt === MAX_REQUEST_ATTEMPTS - 1) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, retryDelay(response, attempt)));
  }
  throw new Error('Discovery request retry limit exceeded');
}

async function safeGet(input: URL, expectedHostname = input.hostname): Promise<SafeResponse> {
  let current = new URL(input);
  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect++) {
    if (current.protocol !== 'https:' || current.username || current.password || (current.port && current.port !== '443'))
      throw new Error('Unsafe URL or redirect rejected');
    const response = await requestWithRetry(current);
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.location;
    if (!location) throw new Error('Redirect did not include a location');
    if (redirect === MAX_REDIRECTS) throw new Error('Redirect limit exceeded');
    const next = new URL(location, current);
    if (next.hostname.toLowerCase() !== expectedHostname.toLowerCase()) throw new Error('Cross-host redirects are not followed during discovery');
    if (next.protocol !== 'https:' || next.username || next.password)
      throw new Error('Unsafe redirect target rejected');
    current = next;
  }
  throw new Error('Redirect limit exceeded');
}

export function isCandidatePath(url: URL): boolean {
  return /(?:career|jobs?|openings?|vacanc|recruit|work-with-us|join-us|positions?)/i.test(url.pathname);
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
      if (url.protocol === 'https:' && url.hostname === base.hostname && !url.username && !url.password)
        found.push(url);
    } catch { /* Ignore malformed sitemap entries. */ }
  });
  return found;
}

/**
 * Fetches only a small same-host set of career pages/sitemaps. All fetched URLs
 * pass DNS pinning, public-IP checks, HTTPS-only redirect validation, byte and
 * time limits, and robots policy. External ATS links are surfaced as candidates
 * but are not fetched during the employer-host crawl.
 */
export async function crawlCareerSeed(seedInput: string, now = new Date()): Promise<SourceCandidate[]> {
  const seed = new URL(seedInput);
  if (seed.protocol !== 'https:' || seed.username || seed.password || (seed.port && seed.port !== '443'))
    throw new Error('Only credential-free standard-port HTTPS seeds are accepted');
  const candidates = new Map<string, SourceCandidate>();
  const add = (input: string, kind: 'seed_domain' | 'career_link' | 'sitemap_url' | 'ats_pattern') => {
    const candidate = candidateFromUrl(input, kind, now.toISOString());
    const prior = candidates.get(candidate.canonicalUrl);
    if (!prior) candidates.set(candidate.canonicalUrl, candidate);
  };
  add(seed.toString(), 'seed_domain');

  const robotsUrl = new URL('/robots.txt', seed.origin);
  let robotsText = '';
  try {
    const robots = await safeGet(robotsUrl, seed.hostname);
    if (robots.status >= 200 && robots.status < 300) robotsText = robots.body;
    else if (robots.status !== 404 && robots.status !== 410) throw new Error('robots.txt could not be checked safely');
  } catch (error) {
    throw new Error('Could not safely retrieve robots.txt: ' + (error instanceof Error ? error.message : 'request failed'));
  }

  const sitemapUrls = new Set<string>([new URL('/sitemap.xml', seed.origin).toString()]);
  const robotsLines = robotsText.split(/\r?\n/);
  for (const line of robotsLines) {
    const match = /^\s*sitemap:\s*(\S+)/i.exec(line);
    if (!match || sitemapUrls.size >= MAX_SITEMAPS_PER_SEED) continue;
    try {
      const sitemap = new URL(match[1]);
      if (sitemap.protocol === 'https:' && sitemap.hostname === seed.hostname && !sitemap.username && !sitemap.password)
        sitemapUrls.add(sitemap.toString());
    } catch { /* Ignore malformed sitemap directives. */ }
  }

  const queue = [seed];
  const seenPages = new Set<string>();
  while (queue.length && seenPages.size < MAX_PAGES_PER_SEED) {
    const target = queue.shift()!;
    if (seenPages.has(target.toString())) continue;
    seenPages.add(target.toString());
    if (target.hostname !== seed.hostname || !allowedByRobots(robotsUrl.toString(), robotsText, target)) continue;
    let response: SafeResponse;
    try { response = await safeGet(target, seed.hostname); } catch { continue; }
    if (response.status < 200 || response.status >= 300) continue;
    const type = String(response.headers['content-type'] ?? '').toLowerCase();
    if (!type.includes('html') && !/\.(?:html?|xhtml)(?:$|\?)/i.test(target.pathname)) continue;
    const $ = load(response.body);
    $('a[href]').each((_index, element) => {
      if (candidates.size >= 250) return;
      const href = $(element).attr('href');
      if (!href) return;
      let resolved: URL;
      try { resolved = new URL(href, response.url); } catch { return; }
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
    const sitemapUrl = new URL(sitemapString);
    if (!allowedByRobots(robotsUrl.toString(), robotsText, sitemapUrl)) continue;
    try {
      const response = await safeGet(sitemapUrl, seed.hostname);
      if (response.status < 200 || response.status >= 300) continue;
      const locations = locationsFromSitemap(response.body, seed);
      for (const url of locations) {
        if (!isCandidatePath(url)) continue;
        add(url.toString(), 'sitemap_url');
        if (candidates.size >= 250) break;
      }
    } catch { /* A failed sitemap does not invalidate candidates from other paths. */ }
  }
  return [...candidates.values()];
}

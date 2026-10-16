import { publicUrl } from '@/lib/security';
import ipaddr from 'ipaddr.js';
import { lookup } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import type { LookupFunction } from 'node:net';
import robotsParser from 'robots-parser';
import {
  SourceError,
  sourceConfigSchema,
  type Source,
  type SourceContext,
  type SourceResponse,
} from './contracts';

export const USER_AGENT = 'CareerAtlasBot/1.0';
export function approvedUrl(value: string, hostname: string) {
  const url = publicUrl(value);
  if (new URL(url).hostname !== hostname.toLowerCase() || hostname.endsWith('.'))
    throw new SourceError('HOST_NOT_APPROVED', 'URL hostname is outside the approved source');
  return url;
}
export function isPublicAddress(address: string) {
  try {
    return ipaddr.process(address).range() === 'unicast';
  } catch {
    return false;
  }
}
export async function resolvePublicAddresses(hostname: string, resolver = lookup) {
  const addresses = await resolver(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some((entry) => !isPublicAddress(entry.address)))
    throw new SourceError(
      'UNSAFE_DNS',
      'Source DNS must resolve exclusively to public unicast addresses',
    );
  return addresses;
}
async function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  let cancel: () => void = () => {};
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        cancel = () => reject(signal.reason);
        signal.addEventListener('abort', cancel, { once: true });
      }),
    ]);
  } finally {
    signal.removeEventListener('abort', cancel);
  }
}
export type Transport = (
  url: string,
  options: { signal: AbortSignal; headers: Record<string, string>; maxBytes: number },
) => Promise<SourceResponse>;
export const secureTransport: Transport = async (value, options) => {
  const url = new URL(value);
  const addresses = await abortable(resolvePublicAddresses(url.hostname), options.signal);
  // Pin the vetted DNS answers into the TLS connection; no second lookup/rebinding window.
  const pinned: LookupFunction = (_hostname, settings, done) => {
    if (settings.all) done(null, addresses);
    else done(null, addresses[0].address, addresses[0].family);
  };
  return new Promise((resolve, reject) => {
    const req = httpsRequest(
      url,
      {
        method: 'GET',
        headers: options.headers,
        signal: options.signal,
        lookup: pinned,
        agent: false,
        maxHeaderSize: 16384,
        rejectUnauthorized: true,
      },
      (res) => {
        const headers = new Headers();
        for (const [key, value] of Object.entries(res.headers))
          if (value !== undefined)
            headers.set(key, Array.isArray(value) ? value.join(', ') : value);
        if (
          Number(headers.get('content-length')) > options.maxBytes ||
          !['', 'identity'].includes(headers.get('content-encoding') ?? '')
        ) {
          res.destroy();
          reject(new SourceError('RESPONSE_LIMIT', 'Response size or encoding is not permitted'));
          return;
        }
        let size = 0;
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > options.maxBytes) {
            res.destroy(
              new SourceError('RESPONSE_LIMIT', 'Source response exceeds configured byte limit'),
            );
          } else chunks.push(chunk);
        });
        res.on('error', reject);
        res.on('end', () =>
          resolve({
            url: value,
            status: res.statusCode ?? 0,
            headers,
            body: Buffer.concat(chunks).toString('utf8'),
          }),
        );
      },
    );
    req.on('error', reject);
    req.end();
  });
};
export const fixtureTransport =
  (fetcher: typeof fetch): Transport =>
  async (url, options) => {
    if (process.env.APP_ENV !== 'test')
      throw new SourceError('TEST_TRANSPORT', 'Fixture transport is restricted to tests');
    const response = await fetcher(url, {
      redirect: 'error',
      signal: options.signal,
      headers: options.headers,
    });
    const reader = response.body?.getReader();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    if (reader)
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        bytes += value.length;
        if (bytes > options.maxBytes) {
          await reader.cancel();
          throw new SourceError('RESPONSE_LIMIT', 'Source response exceeds configured byte limit');
        }
        chunks.push(value);
      }
    return {
      url,
      status: response.status,
      headers: response.headers,
      body: Buffer.concat(chunks).toString('utf8'),
    };
  };
export function retryAfter(value: string | null, now = Date.now()) {
  if (!value) return undefined;
  const ms = /^\d+$/.test(value) ? Number(value) * 1000 : Date.parse(value) - now;
  return Number.isFinite(ms) ? Math.min(86400000, Math.max(1000, ms)) : undefined;
}
export async function delay(ms: number, signal: AbortSignal) {
  signal.throwIfAborted();
  await new Promise<void>((resolve, reject) => {
    const cancel = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', cancel);
      resolve();
    }, ms);
    signal.addEventListener('abort', cancel, { once: true });
  });
}
export function createSourceContext(
  source: Source,
  options: {
    transport?: Transport;
    signal?: AbortSignal;
    checkCancelled?: () => Promise<void>;
    pace?: (hostname: string, intervalMs: number, signal: AbortSignal) => Promise<void>;
  } = {},
): SourceContext {
  if (!source.approvedHostname || !source.endpointUrl)
    throw new SourceError('CONFIGURATION', 'An approved endpoint and hostname are required');
  const config = sourceConfigSchema.parse(source.config);
  const signal = AbortSignal.any([
    options.signal ?? new AbortController().signal,
    AbortSignal.timeout(180000),
  ]);
  const transport = options.transport ?? secureTransport;
  let requests = 0;
  let robots: ReturnType<typeof robotsParser> | undefined;
  const checkCancelled = options.checkCancelled ?? (async () => {});
  let crawlDelay = 0;
  async function raw(value: string, credential: boolean): Promise<SourceResponse> {
    signal.throwIfAborted();
    await checkCancelled();
    const url = approvedUrl(value, source.approvedHostname!);
    if (++requests > config.maxRequests)
      throw new SourceError('REQUEST_LIMIT', 'Request budget exhausted; snapshot is incomplete');
    await options.pace?.(
      source.approvedHostname!,
      Math.max(60000 / config.requestsPerMinute, crawlDelay),
      signal,
    );
    const headers: Record<string, string> = {
      Accept: '*/*',
      'Accept-Encoding': 'identity',
      'User-Agent': USER_AGENT,
    };
    if (credential && config.credentialEnv) {
      const key = process.env[config.credentialEnv];
      if (!key || /[\r\n]/.test(key))
        throw new SourceError('CREDENTIALS', 'Configured source credential is unavailable');
      headers.Authorization = 'Bearer ' + key;
    }
    try {
      const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(config.timeoutMs)]);
      const response = await abortable(
        transport(url, { headers, maxBytes: config.maxBytes, signal: requestSignal }),
        requestSignal,
      );
      if (Buffer.byteLength(response.body) > config.maxBytes)
        throw new SourceError('RESPONSE_LIMIT', 'Source response exceeds configured byte limit');
      return response;
    } catch (error) {
      if (error instanceof SourceError) throw error;
      if (signal.aborted)
        throw new SourceError('TIMEOUT', 'Source operation timed out or was cancelled', true);
      throw new SourceError('NETWORK', 'Source connection or request timeout failed', true);
    }
  }
  async function request(
    value: string,
    types: string[],
    flags: { robots?: boolean; allowMissing?: boolean; credential?: boolean } = {},
  ) {
    let url = approvedUrl(value, source.approvedHostname!);
    if (flags.robots !== false && config.robots) {
      if (!robots) {
        const robotsUrl = `https://${source.approvedHostname}/robots.txt`;
        const response = await raw(robotsUrl, false);
        if (response.status === 404 || response.status === 410)
          robots = robotsParser(robotsUrl, '');
        else if (
          response.status === 200 &&
          /^(text\/plain|text\/html)(;|$)/i.test(response.headers.get('content-type') ?? '') &&
          !/<(?:!doctype|html|head|body|script|form)\b/i.test(response.body)
        )
          robots = robotsParser(robotsUrl, response.body);
        else
          throw new SourceError(
            'ROBOTS_UNAVAILABLE',
            'robots.txt could not be verified; fetching is stopped',
            response.status >= 500 || response.status === 429,
            retryAfter(response.headers.get('retry-after')),
          );
        crawlDelay = (robots.getCrawlDelay(USER_AGENT) ?? 0) * 1000;
        if (crawlDelay > 60000)
          throw new SourceError('ROBOTS_DELAY', 'Crawl delay exceeds the worker request budget');
      }
    }
    for (let hop = 0; hop <= 3; hop++) {
      if (robots?.isAllowed(url, USER_AGENT) === false)
        throw new SourceError('ROBOTS_DENIED', 'Source robots policy disallows this URL');
      const response = await raw(url, flags.credential !== false);
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const target = response.headers.get('location');
        if (!target || hop === 3)
          throw new SourceError('REDIRECT_LIMIT', 'Unresolvable source redirect');
        url = approvedUrl(new URL(target, url).toString(), source.approvedHostname!);
        continue;
      }
      if (response.status === 429)
        throw new SourceError(
          'RATE_LIMIT',
          'Source rate limit reached',
          true,
          retryAfter(response.headers.get('retry-after')) ?? 60000,
        );
      if (flags.allowMissing && [404, 410].includes(response.status)) return { ...response, url };
      if (response.status < 200 || response.status >= 300)
        throw new SourceError(
          'HTTP_' + response.status,
          'Source HTTP ' + response.status,
          response.status >= 500,
        );
      const type = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
      if (!types.includes(type) && !(types.includes('application/json') && type.endsWith('+json')))
        throw new SourceError('CONTENT_TYPE', 'Source returned an unexpected content type');
      return { ...response, url };
    }
    throw new SourceError('REDIRECT_LIMIT', 'Source redirect budget exhausted');
  }
  return { source, config, signal, request, checkCancelled, requestCount: () => requests };
}

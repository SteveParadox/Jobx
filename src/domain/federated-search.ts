import { searchJobs } from '@/domain/search';
import { jobPath } from '@/domain/seo';
import {
  ADZUNA_MARKET_DOMAINS,
  fetchAdzuna,
  fetchJooble,
  fetchUsaJobs,
  fetchHimalayas,
  uniqueLeads,
  type ProviderId,
  type SearchLead,
} from '@/integrations/federated-providers';
import { env } from '@/lib/config';
import { getRedis, rateLimit } from '@/lib/http';
import { digest } from '@/lib/security';
import { z } from 'zod';

export const federatedSearchSchema = z
  .object({
    q: z.string().trim().min(2).max(120),
    location: z.string().trim().max(120).default(''),
    country: z
      .string()
      .trim()
      .regex(/^[A-Z]{2}$/)
      .optional(),
    market: z
      .string()
      .trim()
      .regex(/^[a-z]{2}$/)
      .optional(),
    remoteOnly: z.enum(['true', 'false']).default('false'),
    provider: z.enum(['all', 'jobx', 'himalayas', 'adzuna', 'usajobs', 'jooble']).default('all'),
    page: z.coerce.number().int().min(1).max(20).default(1),
  })
  .strict();

type Status = {
  provider: ProviderId;
  state: 'ok' | 'not_configured' | 'skipped' | 'error';
  count: number;
  note: string;
};
const providerOrder: ProviderId[] = ['jobx', 'himalayas', 'adzuna', 'usajobs', 'jooble'];

export async function federatedSearch(input: unknown) {
  const options = federatedSearchSchema.parse(input);
  const selected = (provider: ProviderId) =>
    options.provider === 'all' || options.provider === provider;
  const query = {
    q: options.q,
    location: options.location,
    market: options.market,
    page: options.page,
  };
  const outputs = new Map<ProviderId, { status: Status; jobs: SearchLead[] }>();
  const tasks: Promise<void>[] = [];
  const setStatus = (
    provider: ProviderId,
    state: Status['state'],
    note: string,
    jobs: SearchLead[] = [],
  ) => outputs.set(provider, { status: { provider, state, note, count: jobs.length }, jobs });
  const execute = (provider: ProviderId, action: () => Promise<SearchLead[]>) => {
    tasks.push(
      action()
        .then((jobs) => { setStatus(provider, 'ok', 'Fetched from the declared source.', jobs); })
        .catch(() => {
          // Never disclose provider request URLs: some contain API keys.
          setStatus(provider, 'error', 'Provider could not be reached or returned invalid data.');
        }),
    );
  };

  if (selected('jobx')) {
    execute('jobx', async () => {
      const result = await searchJobs({
        q: options.q,
        page: options.page,
        ...(options.country ? { country: options.country } : {}),
        ...(options.remoteOnly === 'true' ? { workplace: 'remote' } : {}),
      });
      return result.jobs.map((job) => ({
        id: 'jobx:' + job.id,
        provider: 'jobx' as const,
        providerName: 'Jobx approved catalog',
        title: job.title,
        company: job.companyName,
        location: job.locationLabel,
        url: jobPath(job),
        excerpt: job.descriptionText.slice(0, 360),
        postedAt: job.originalPostedAt?.toISOString() ?? null,
        provenance: 'published_catalog' as const,
        attributionUrl: null,
        attributionLogoUrl: null,
      }));
    });
  }

  if (selected('himalayas')) {
    if (!env.FEDERATED_HIMALAYAS_ENABLED)
      setStatus('himalayas', 'not_configured', 'Public keyless source is disabled by operator setting.');
    else
      execute('himalayas', async () => {
        // The public API is shared. Cache identical queries for six hours.
        // Do not send account identifiers, CVs or user profiles to this service.
        const country = options.country ?? options.market?.toUpperCase();
        const cacheKey = 'federated:himalayas:' + digest(
          JSON.stringify({ q: options.q.toLowerCase(), country: country ?? '', page: options.page }),
        );
        const redis = env.REDIS_URL ? getRedis() : null;
        if (redis) {
          const cached = await redis.get(cacheKey);
          if (cached) {
            try {
              const parsed: unknown = JSON.parse(cached);
              if (Array.isArray(parsed) && parsed.every((lead) =>
                lead && typeof lead === 'object' && lead.provider === 'himalayas'
              )) return (parsed as SearchLead[]).filter((lead) =>
                !lead.expiresAt || Date.parse(lead.expiresAt) > Date.now()
              );
            } catch {
              // Refetch invalid cached values rather than surfacing broken results.
            }
          }
        }
        await rateLimit('federated:provider:himalayas:day', 80, 86400);
        const leads = await fetchHimalayas({ q: options.q, page: options.page, country });
        if (redis) await redis.set(cacheKey, JSON.stringify(leads), 'EX', 21600);
        return leads;
      });
  }

  if (selected('adzuna')) {
    const logo = env.FEDERATED_ADZUNA_ATTRIBUTION_LOGO_URL?.trim() ?? '';
    // Serve approved logo art from our own public directory, not an arbitrary third-party tracker.
    const logoSafe = /^\/[a-z0-9/_-]+\.(?:png|svg|webp)$/i.test(logo) && !logo.includes('..');
    const approvedMarkets = [...new Set(
      (env.FEDERATED_ADZUNA_MARKETS ?? '')
        .split(',')
        .map((market) => market.trim().toLowerCase())
        .filter((market) => Object.hasOwn(ADZUNA_MARKET_DOMAINS, market)),
    )].slice(0, 12);
    const markets = options.market
      ? approvedMarkets.filter((value) => value === options.market)
      : approvedMarkets.slice(0, 2);
    if (
      !env.FEDERATED_ADZUNA_ENABLED ||
      !env.FEDERATED_ADZUNA_APP_ID ||
      !env.FEDERATED_ADZUNA_APP_KEY ||
      !logoSafe ||
      approvedMarkets.length === 0
    )
      setStatus('adzuna', 'not_configured', 'Provider key, permitted markets, and required official logo/attribution must be configured.');
    else if (options.remoteOnly === 'true')
      setStatus('adzuna', 'skipped', 'Remote-only filtering is not confirmed for this API adapter.');
    else if (!markets.length)
      setStatus('adzuna', 'skipped', 'Selected market is not among the authorized Adzuna markets.');
    else
      execute('adzuna', async () => {
        // Limit this provider globally, in addition to per-account API throttling.
        await rateLimit('federated:provider:adzuna:day', 90, 86400);
        return fetchAdzuna(query, {
          appId: env.FEDERATED_ADZUNA_APP_ID!,
          appKey: env.FEDERATED_ADZUNA_APP_KEY!,
          logoUrl: logo,
        }, markets);
      });
  }

  if (selected('usajobs')) {
    if (!env.FEDERATED_USAJOBS_ENABLED || !env.FEDERATED_USAJOBS_API_KEY || !env.FEDERATED_USAJOBS_EMAIL)
      setStatus('usajobs', 'not_configured', 'USAJOBS registered email and official API key are required.');
    else if (options.market && options.market !== 'us')
      setStatus('usajobs', 'skipped', 'USAJOBS searches United States announcements only.');
    else
      execute('usajobs', async () => {
        await rateLimit('federated:provider:usajobs:day', 300, 86400);
        return fetchUsaJobs(
          query,
          { apiKey: env.FEDERATED_USAJOBS_API_KEY!, email: env.FEDERATED_USAJOBS_EMAIL! },
          options.remoteOnly === 'true',
        );
      });
  }

  if (selected('jooble')) {
    const region = env.FEDERATED_JOOBLE_REGION?.trim().toLowerCase() ?? '';
    if (
      !env.FEDERATED_JOOBLE_ENABLED ||
      !env.FEDERATED_JOOBLE_API_KEY ||
      !/^[a-z]{2}$/.test(region)
    )
      setStatus('jooble', 'not_configured', 'A Jooble key and its exact regional market must be configured.');
    else if (options.remoteOnly === 'true')
      setStatus('jooble', 'skipped', 'This adapter cannot establish an exact remote-only feed.');
    else if (options.market && options.market !== (region === 'uk' ? 'gb' : region))
      setStatus('jooble', 'skipped', 'The configured Jooble key covers a different national market.');
    else if (!options.location)
      setStatus('jooble', 'skipped', 'Provide a location to search the configured Jooble region.');
    else
      execute('jooble', async () => {
        // Jooble free keys have an unusually small lifetime allowance.
        await rateLimit('federated:provider:jooble:day', 10, 86400);
        return fetchJooble(query, {
          apiKey: env.FEDERATED_JOOBLE_API_KEY!,
          region,
        });
      });
  }

  await Promise.all(tasks);
  // Preserve each provider's relevance ordering. Rankings cannot be compared across APIs.
  const grouped = providerOrder.flatMap((id) => outputs.get(id)?.jobs ?? []);
  const providers = providerOrder.flatMap((id) => {
    const item = outputs.get(id);
    return item ? [item.status] : [];
  });
  return {
    items: uniqueLeads(grouped, 75),
    providers,
    query: options,
    checkedAt: new Date().toISOString(),
    explanation:
      'This combines approved Jobx listings with separately labeled external provider leads. External leads are not imported, employer-verified by Jobx, or proof of applicant eligibility. Open the source and verify the posting before applying.',
  };
}

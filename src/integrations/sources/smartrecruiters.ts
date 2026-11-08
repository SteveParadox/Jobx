import { z } from 'zod';
import type { SourceAdapter, Snapshot } from './contracts';
import { SourceError, JSON_TYPES } from './contracts';
import { normalizedRecord, snapshotFromRows } from './normalize';

const listingSchema = z.object({
  id: z.union([z.string(), z.number()]).transform(String),
  name: z.string().min(2),
  location: z.object({
    country: z.string().optional(),
    region: z.string().optional(),
    city: z.string().optional(),
    remote: z.boolean().optional(),
  }).optional(),
}).passthrough();
const responseSchema = z.object({
  content: z.array(z.unknown()),
  totalFound: z.number().int().min(0),
}).passthrough();
const detailsSchema = z.object({
  id: z.union([z.string(), z.number()]).transform(String),
  name: z.string().min(2),
  applyUrl: z.string().min(8),
  active: z.boolean().optional(),
  releasedDate: z.string().optional(),
  location: listingSchema.shape.location,
  jobAd: z.object({
    sections: z.record(z.string(), z.object({ text: z.string().optional() }).passthrough()),
  }).optional(),
}).passthrough();

/** A fixed company board, never an unbounded company-discovery scraper. */
export const smartRecruitersAdapter: SourceAdapter = {
  provider: 'smartrecruiters',
  discover: (source) =>
    'https://api.smartrecruiters.com/v1/companies/' +
    encodeURIComponent(source.boardToken) + '/postings',
  fetch: async (ctx) => {
    const token = ctx.source.boardToken;
    if (!/^[a-z0-9_-]{1,100}$/i.test(token))
      throw new SourceError('BOARD_TOKEN', 'Invalid approved SmartRecruiters company token');
    const base = 'https://api.smartrecruiters.com/v1/companies/' +
      encodeURIComponent(token) + '/postings';
    const snapshot: Snapshot = { records: [], rejected: [], complete: true, requests: 0 };
    const perPage = Math.min(ctx.config.pageSize, 100);
    let offset = 0;
    let finished = false;
    for (let page = 0; page < ctx.config.maxPages; page++) {
      await ctx.checkCancelled();
      // Request limits are enforced by ctx.request, but reserve capacity for
      // the detail endpoints before starting a page.
      if (ctx.requestCount() + 1 + perPage > ctx.config.maxRequests)
        throw new SourceError('REQUEST_LIMIT', 'Increase the approved source request budget');
      const url = new URL(base);
      url.searchParams.set('destination', 'PUBLIC');
      url.searchParams.set('limit', String(perPage));
      url.searchParams.set('offset', String(offset));
      const response = await ctx.request(url.toString(), JSON_TYPES);
      let list: z.infer<typeof responseSchema>;
      try { list = responseSchema.parse(JSON.parse(response.body)); }
      catch { throw new SourceError('ENVELOPE', 'Invalid SmartRecruiters listing envelope'); }
      if (list.content.length > perPage)
        throw new SourceError('ENVELOPE', 'SmartRecruiters exceeded requested page size');
      const ids = new Set<string>();
      for (const raw of list.content) {
        let listing: z.infer<typeof listingSchema>;
        try { listing = listingSchema.parse(raw); }
        catch {
          snapshot.rejected.push({ reason: 'Invalid public listing shape' });
          snapshot.complete = false;
          continue;
        }
        if (ids.has(listing.id))
          throw new SourceError('REPEATED_PAGE', 'Repeated listing ID in source page');
        ids.add(listing.id);
        const detailUrl = base + '/' + encodeURIComponent(listing.id);
        const detail = await ctx.request(detailUrl, JSON_TYPES);
        const one = snapshotFromRows([detail.body], (body) => {
          const data = detailsSchema.parse(JSON.parse(String(body)));
          if (data.active === false) return null;
          if (data.id !== listing.id)
            throw new SourceError('IDENTITY', 'SmartRecruiters detail identity mismatch');
          const parts = Object.values(data.jobAd?.sections ?? {})
            .map((section) => section.text?.trim() ?? '')
            .filter(Boolean);
          // The description must come from the detail response; the list's
          // short title is not sufficient to publish an employer vacancy.
          const descriptionHtml = parts.join('<h3>Details</h3>');
          const location = data.location ?? listing.location;
          const label = [location?.city, location?.region, location?.country]
            .filter(Boolean).join(', ') || 'Location not disclosed';
          return normalizedRecord({
            externalId: data.id,
            sourceUrl: detailUrl,
            applyUrl: data.applyUrl,
            title: data.name,
            descriptionHtml,
            locationLabel: location?.remote ? 'Remote' : label,
            country: location?.country,
            region: location?.region,
            city: location?.city,
            workplace: location?.remote ? 'remote' : 'unknown',
            // A remote flag alone does not establish applicant-country eligibility.
            remoteEligibility: 'unknown',
            sourcePostedAt: data.releasedDate,
          }, detailUrl);
        });
        snapshot.records.push(...one.records);
        snapshot.rejected.push(...one.rejected);
        if (one.rejected.length) snapshot.complete = false;
      }
      offset += list.content.length;
      if (offset >= list.totalFound) {
        finished = true;
        break;
      }
      if (list.content.length === 0)
        throw new SourceError('PAGINATION', 'Incomplete SmartRecruiters page');
    }
    if (!finished)
      throw new SourceError('PAGINATION_LIMIT', 'SmartRecruiters complete snapshot not established');
    snapshot.requests = ctx.requestCount();
    return snapshot;
  },
};

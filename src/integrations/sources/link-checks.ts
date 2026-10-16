import { createSourceContext, type Transport } from './http';
import { canonicalApplicationUrl } from './normalize';
import { HTML_TYPES, SourceError, type Snapshot, type SourceContext } from './contracts';
export async function checkApplicationLinks(
  snapshot: Snapshot,
  context: SourceContext,
  options: {
    transport?: Transport;
    pace?: (host: string, interval: number, signal: AbortSignal) => Promise<void>;
  },
) {
  if (!context.config.checkApplicationLinks) return snapshot;
  if (!context.config.applicationFetchPermitted)
    throw new SourceError('PERMISSION', 'Application-link fetch permission is required');
  const contexts = new Map<string, SourceContext>();
  for (const row of snapshot.records) {
    const hostname = new URL(row.data.applyUrl!).hostname;
    if (!context.source.applicationHostnames.includes(hostname))
      throw new SourceError('APPLICATION_HOST', 'Unapproved application hostname');
    let links = contexts.get(hostname);
    if (!links) {
      links = createSourceContext(
        {
          ...context.source,
          approvedHostname: hostname,
          endpointUrl: row.data.applyUrl!,
          config: { ...context.config, credentialEnv: undefined, robots: true },
        },
        { ...options, signal: context.signal, checkCancelled: context.checkCancelled },
      );
      contexts.set(hostname, links);
    }
    try {
      const response = await links.request(row.data.applyUrl!, HTML_TYPES, {
        allowMissing: true,
        credential: false,
      });
      row.linkStatus =
        response.status === 410 ? 'gone' : response.status === 404 ? 'unavailable' : 'reachable';
      if (row.linkStatus === 'reachable') row.data.applyUrl = canonicalApplicationUrl(response.url);
    } catch (error) {
      if (
        !(error instanceof SourceError) ||
        !['HOST_NOT_APPROVED', 'REDIRECT_LIMIT', 'CONTENT_TYPE'].includes(error.code)
      )
        throw error;
      row.linkStatus = 'unavailable';
      snapshot.rejected.push({
        externalId: row.externalId,
        reason: 'APPLICATION_LINK_REVIEW: unsafe redirect or unexpected application response',
        raw: { sourceUrl: row.sourceUrl, applicationUrl: row.data.applyUrl },
      });
      snapshot.complete = false;
    }
    const count =
      snapshot.requests + [...contexts.values()].reduce((n, ctx) => n + ctx.requestCount(), 0);
    if (count > context.config.maxRequests)
      throw new SourceError(
        'REQUEST_LIMIT',
        'Combined feed and link-check request budget exhausted',
      );
  }
  snapshot.requests += [...contexts.values()].reduce((n, ctx) => n + ctx.requestCount(), 0);
  return snapshot;
}

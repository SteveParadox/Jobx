/**
 * Deterministic source discovery primitives.
 *
 * Discovery identifies candidate feeds only. It does not fetch a candidate,
 * assert redistribution permission, or approve publication. Those decisions
 * remain with the existing source-management authorization workflow.
 */
export type AtsProvider = 'greenhouse' | 'lever' | 'lever_eu' | 'ashby';
export type CandidateState = 'DISCOVERED' | 'IDENTIFIED' | 'REVIEW_REQUIRED' | 'REJECTED';

export interface DiscoveryEvidence {
  kind: 'seed_domain' | 'career_link' | 'sitemap_url' | 'ats_pattern';
  url: string;
  observedAt: string;
  detail: string;
}

export interface SourceCandidate {
  canonicalUrl: string;
  hostname: string;
  provider: AtsProvider | null;
  boardToken: string | null;
  state: CandidateState;
  requiresPermissionReview: true;
  evidence: DiscoveryEvidence[];
}

const TRACKING_PARAMETERS = new Set(['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'ref']);

function assertPublicHttpsUrl(input: string): URL {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error('Candidate URL must be an absolute URL');
  }
  if (url.protocol !== 'https:') throw new Error('Only HTTPS discovery candidates are accepted');
  if (url.username || url.password) throw new Error('Credential-bearing URLs are not accepted');
  if (url.port && url.port !== '443') throw new Error('Non-standard ports are not accepted for discovery');
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (
    !host ||
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    /^\d{1,3}(\.\d{1,3}){3}$/.test(host) ||
    host.includes(':') ||
    !host.includes('.')
  ) throw new Error('Candidate hostname is not an eligible public DNS name');
  url.hostname = host;
  url.hash = '';
  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING_PARAMETERS.has(key.toLowerCase())) url.searchParams.delete(key);
  }
  url.searchParams.sort();
  return url;
}

export function canonicalizeCandidateUrl(input: string): string {
  const url = assertPublicHttpsUrl(input);
  if (url.pathname.length > 2048 || url.href.length > 4096) throw new Error('Candidate URL exceeds discovery limits');
  url.pathname = url.pathname.replace(/\/{2,}/g, '/').replace(/\/$/, '') || '/';
  return url.toString();
}

export function detectAts(input: string): { provider: AtsProvider; boardToken: string } | null {
  let url: URL;
  try {
    url = assertPublicHttpsUrl(input);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  const path = url.pathname.split('/').filter(Boolean);
  if (host === 'boards.greenhouse.io' || host === 'job-boards.greenhouse.io') {
    const token = path[0];
    return token && /^[a-z0-9_-]{1,100}$/i.test(token) ? { provider: 'greenhouse', boardToken: token } : null;
  }
  if (host === 'jobs.lever.co') {
    const token = path[0];
    return token && /^[a-z0-9_-]{1,100}$/i.test(token) ? { provider: 'lever', boardToken: token } : null;
  }
  if (host === 'jobs.eu.lever.co') {
    const token = path[0];
    return token && /^[a-z0-9_-]{1,100}$/i.test(token) ? { provider: 'lever_eu', boardToken: token } : null;
  }
  if (host === 'jobs.ashbyhq.com') {
    const token = path[0];
    return token && /^[a-z0-9_-]{1,100}$/i.test(token) ? { provider: 'ashby', boardToken: token } : null;
  }
  return null;
}

export function candidateFromUrl(
  input: string,
  evidenceKind: DiscoveryEvidence['kind'] = 'career_link',
  observedAt = new Date().toISOString(),
): SourceCandidate {
  const canonicalUrl = canonicalizeCandidateUrl(input);
  const url = new URL(canonicalUrl);
  const ats = detectAts(canonicalUrl);
  const evidence: DiscoveryEvidence[] = [{
    kind: ats ? 'ats_pattern' : evidenceKind,
    url: canonicalUrl,
    observedAt,
    detail: ats ? `Recognized ${ats.provider} board URL pattern; permission remains unverified` : 'Candidate URL observed; provider and permission require verification',
  }];
  return {
    canonicalUrl,
    hostname: url.hostname,
    provider: ats?.provider ?? null,
    boardToken: ats?.boardToken ?? null,
    state: ats ? 'REVIEW_REQUIRED' : 'DISCOVERED',
    requiresPermissionReview: true,
    evidence,
  };
}

/**
 * Only links within the supplied employer hostname are accepted from HTML
 * or sitemap parsing. External ATS links can be separately passed through
 * candidateFromUrl and always remain review-required.
 */
export function resolveSameHostLink(baseUrl: string, href: string): string | null {
  try {
    const base = assertPublicHttpsUrl(baseUrl);
    const target = assertPublicHttpsUrl(new URL(href, base).toString());
    if (target.hostname !== base.hostname) return null;
    return canonicalizeCandidateUrl(target.toString());
  } catch {
    return null;
  }
}

export function mergeCandidateEvidence(existing: SourceCandidate, incoming: SourceCandidate): SourceCandidate {
  if (existing.canonicalUrl !== incoming.canonicalUrl) throw new Error('Cannot merge different candidate identities');
  const seen = new Set(existing.evidence.map((item) => `${item.kind}|${item.url}|${item.detail}`));
  const evidence = [...existing.evidence];
  for (const item of incoming.evidence) {
    const key = `${item.kind}|${item.url}|${item.detail}`;
    if (!seen.has(key)) {
      seen.add(key);
      evidence.push(item);
    }
  }
  return { ...existing, evidence };
}

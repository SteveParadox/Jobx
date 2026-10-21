import { getDb } from '@/db';
import * as s from '@/db/schema';
import { candidateFromUrl } from './source-classifier';
import { log } from '@/lib/log';

/**
 * Bounded cold-start discovery from operator-configured seed URLs.
 * This intentionally performs no network requests and never authorizes a source.
 * Future provider/sitemap discovery must pass through the same candidate/evidence
 * store and SSRF-safe request layer before adding any network behavior.
 */
export async function runConfiguredSeedDiscovery(seedList: string, now = new Date()) {
  const seeds = [...new Set(seedList.split(/[\\n,;]+/).map((item) => item.trim()).filter(Boolean))].slice(0, 200);
  const db = getDb();
  const [run] = await db.insert(s.discoveryRuns).values({
    trigger: 'configured_seeds',
    status: 'running',
    seedsSeen: seeds.length,
  }).returning({ id: s.discoveryRuns.id });
  let found = 0;
  let updated = 0;
  let rejected = 0;
  try {
    for (const seed of seeds) {
      try {
        const candidate = candidateFromUrl(seed, 'seed_domain', now.toISOString());
        const existing = await db.select({ id: s.discoveryCandidates.id, evidence: s.discoveryCandidates.evidence })
          .from(s.discoveryCandidates)
          .where((await import('drizzle-orm')).eq(s.discoveryCandidates.canonicalUrl, candidate.canonicalUrl))
          .limit(1);
        const evidence = Array.isArray(existing[0]?.evidence) ? existing[0].evidence as unknown[] : [];
        const combined = [...evidence];
        const evidenceKey = JSON.stringify(candidate.evidence[0]);
        if (!combined.some((item) => JSON.stringify(item) === evidenceKey)) combined.push(candidate.evidence[0]);
        await db.insert(s.discoveryCandidates).values({
          canonicalUrl: candidate.canonicalUrl,
          hostname: candidate.hostname,
          provider: candidate.provider,
          boardToken: candidate.boardToken,
          state: candidate.state,
          requiresPermissionReview: true,
          evidence: combined,
          lastObservedAt: now,
        }).onConflictDoUpdate({
          target: s.discoveryCandidates.canonicalUrl,
          set: {
            provider: candidate.provider,
            boardToken: candidate.boardToken,
            evidence: combined,
            lastObservedAt: now,
            state: candidate.state,
            requiresPermissionReview: true,
          },
        });
        if (existing.length) updated++;
        else found++;
      } catch {
        rejected++;
      }
    }
    await db.update(s.discoveryRuns).set({
      status: 'completed', candidatesFound: found, candidatesUpdated: updated,
      rejected, finishedAt: now,
    }).where((await import('drizzle-orm')).eq(s.discoveryRuns.id, run.id));
    log('discovery_completed', { runId: run.id, seedsSeen: seeds.length, candidatesFound: found, candidatesUpdated: updated, rejected });
    return { runId: run.id, seedsSeen: seeds.length, candidatesFound: found, candidatesUpdated: updated, rejected };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown discovery failure';
    await db.update(s.discoveryRuns).set({ status: 'failed', error: message.slice(0, 500), finishedAt: now })
      .where((await import('drizzle-orm')).eq(s.discoveryRuns.id, run.id));
    log('discovery_failed', { runId: run.id, error: message });
    throw error;
  }
}

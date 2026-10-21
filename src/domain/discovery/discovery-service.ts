import { getDb } from '@/db';
import * as s from '@/db/schema';
import { candidateFromUrl } from './source-classifier';
import { log } from '@/lib/log';
import { desc, eq, gte } from 'drizzle-orm';

/**
 * Bounded cold-start discovery from operator-configured seed URLs.
 * This intentionally performs no network requests and never authorizes a source.
 * Future provider/sitemap discovery must pass through the same candidate/evidence
 * store and SSRF-safe request layer before adding any network behavior.
 */
export async function runConfiguredSeedDiscovery(
  seedList: string,
  intervalMinutes = 60,
  now = new Date(),
) {
  const seeds = [...new Set(seedList.split(/[\\n,;]+/).map((item) => item.trim()).filter(Boolean))].slice(0, 200);
  if (!seeds.length) return { skipped: true, reason: 'no_configured_seeds', seedsSeen: 0 };
  const db = getDb();
  const recentCutoff = new Date(now.getTime() - Math.max(15, Math.min(10080, intervalMinutes)) * 60_000);
  const [recentRun] = await db.select({ id: s.discoveryRuns.id })
    .from(s.discoveryRuns)
    .where(gte(s.discoveryRuns.startedAt, recentCutoff))
    .orderBy(desc(s.discoveryRuns.startedAt))
    .limit(1);
  if (recentRun) return { skipped: true, reason: 'discovery_interval_not_elapsed', runId: recentRun.id };

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
        const [existing] = await db.select({
          id: s.discoveryCandidates.id,
          evidence: s.discoveryCandidates.evidence,
        }).from(s.discoveryCandidates)
          .where(eq(s.discoveryCandidates.canonicalUrl, candidate.canonicalUrl))
          .limit(1);
        const evidence = Array.isArray(existing?.evidence) ? existing.evidence as Array<Record<string, unknown>> : [];
        const incoming = candidate.evidence[0];
        const duplicateEvidence = evidence.some((item) =>
          item.kind === incoming.kind && item.url === incoming.url && item.detail === incoming.detail,
        );
        const combined = duplicateEvidence
          ? evidence
          : [...evidence, incoming].slice(-25);
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
        if (existing) updated++;
        else found++;
      } catch {
        rejected++;
      }
    }
    await db.update(s.discoveryRuns).set({
      status: 'completed',
      candidatesFound: found,
      candidatesUpdated: updated,
      rejected,
      finishedAt: now,
    }).where(eq(s.discoveryRuns.id, run.id));
    log('discovery_completed', {
      runId: run.id, seedsSeen: seeds.length, candidatesFound: found,
      candidatesUpdated: updated, rejected,
    });
    return { runId: run.id, seedsSeen: seeds.length, candidatesFound: found, candidatesUpdated: updated, rejected };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown discovery failure';
    await db.update(s.discoveryRuns).set({
      status: 'failed', error: message.slice(0, 500), finishedAt: now,
    }).where(eq(s.discoveryRuns.id, run.id));
    log('discovery_failed', { runId: run.id, error: message });
    throw error;
  }
}

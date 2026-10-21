import { getDb } from '@/db';
import * as s from '@/db/schema';
import { crawlCareerSeed } from './career-crawler';
import { log } from '@/lib/log';
import { and, desc, eq, gte, sql } from 'drizzle-orm';

const MAX_SEEDS = 25;
const MAX_CANDIDATES_PER_RUN = 1000;
const MAX_INTERVAL_MINUTES = 10080;

export async function runConfiguredSeedDiscovery(
  seedList: string,
  intervalMinutes = 60,
  now = new Date(),
  force = false,
) {
  const seeds = [...new Set(seedList.split(/[\n,;]+/).map((item) => item.trim()).filter(Boolean))]
    .slice(0, MAX_SEEDS);
  if (!seeds.length) return { skipped: true, reason: 'no_configured_seeds', seedsSeen: 0 };

  const db = getDb();
  const interval = Math.max(15, Math.min(MAX_INTERVAL_MINUTES, intervalMinutes));
  const cutoff = new Date(now.getTime() - interval * 60_000);
  const [runningRun] = await db.select({ id: s.discoveryRuns.id })
    .from(s.discoveryRuns)
    .where(eq(s.discoveryRuns.status, 'running'))
    .orderBy(desc(s.discoveryRuns.startedAt)).limit(1);
  if (runningRun) return { skipped: true, reason: 'discovery_run_already_in_progress', runId: runningRun.id };

  const [recentRun] = await db.select({ id: s.discoveryRuns.id })
    .from(s.discoveryRuns)
    .where(gte(s.discoveryRuns.startedAt, cutoff))
    .orderBy(desc(s.discoveryRuns.startedAt)).limit(1);
  if (recentRun && !force)
    return { skipped: true, reason: 'discovery_interval_not_elapsed', runId: recentRun.id };

  const [run] = await db.insert(s.discoveryRuns).values({
    trigger: force ? 'manual' : 'configured_seeds', status: 'running', seedsSeen: seeds.length,
  }).returning({ id: s.discoveryRuns.id });

  let found = 0;
  let updated = 0;
  let rejected = 0;
  let processed = 0;
  try {
    for (const seed of seeds) {
      if (processed >= MAX_CANDIDATES_PER_RUN) break;
      let candidates;
      try {
        candidates = await crawlCareerSeed(seed, now);
      } catch (error) {
        rejected++;
        log('discovery_seed_rejected', {
          runId: run.id, hostname: safeHostname(seed),
          reason: error instanceof Error ? error.message.slice(0, 250) : 'Discovery request failed',
        });
        continue;
      }
      for (const candidate of candidates) {
        if (processed >= MAX_CANDIDATES_PER_RUN) break;
        processed++;
        try {
          const [existing] = await db.select({
            id: s.discoveryCandidates.id, evidence: s.discoveryCandidates.evidence,
          }).from(s.discoveryCandidates)
            .where(eq(s.discoveryCandidates.canonicalUrl, candidate.canonicalUrl)).limit(1);
          const evidence = Array.isArray(existing?.evidence)
            ? existing.evidence as Array<Record<string, unknown>>
            : [];
          const incoming = candidate.evidence[0];
          const duplicate = evidence.some((item) =>
            item.kind === incoming.kind && item.url === incoming.url && item.detail === incoming.detail,
          );
          const combined = duplicate ? evidence : [...evidence, incoming].slice(-25);
          await db.insert(s.discoveryCandidates).values({
            canonicalUrl: candidate.canonicalUrl, hostname: candidate.hostname,
            provider: candidate.provider, boardToken: candidate.boardToken,
            state: candidate.state, requiresPermissionReview: true,
            evidence: combined, lastObservedAt: now,
          }).onConflictDoUpdate({
            target: s.discoveryCandidates.canonicalUrl,
            set: {
              provider: candidate.provider, boardToken: candidate.boardToken,
              evidence: combined, lastObservedAt: now,
              state: sql`CASE WHEN ${s.discoveryCandidates.state} = 'REJECTED' OR ${s.discoveryCandidates.reviewedAt} IS NOT NULL THEN ${s.discoveryCandidates.state} ELSE ${candidate.state} END`,
              requiresPermissionReview: true,
            },
          });
          if (existing) updated++;
          else found++;
        } catch (error) {
          rejected++;
          log('discovery_candidate_rejected', {
            runId: run.id, hostname: candidate.hostname,
            reason: error instanceof Error ? error.message.slice(0, 250) : 'Candidate persistence failed',
          });
        }
      }
    }
    await db.update(s.discoveryRuns).set({
      status: 'completed', candidatesFound: found, candidatesUpdated: updated,
      rejected, finishedAt: now,
    }).where(eq(s.discoveryRuns.id, run.id));
    log('discovery_completed', {
      runId: run.id, seedsSeen: seeds.length, candidatesFound: found,
      candidatesUpdated: updated, rejected, candidatesProcessed: processed,
    });
    return {
      runId: run.id, seedsSeen: seeds.length, candidatesFound: found,
      candidatesUpdated: updated, rejected, candidatesProcessed: processed,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown discovery failure';
    await db.update(s.discoveryRuns).set({
      status: 'failed', error: message.slice(0, 500), finishedAt: now,
    }).where(eq(s.discoveryRuns.id, run.id));
    log('discovery_failed', { runId: run.id, error: message });
    throw error;
  }
}

function safeHostname(input: string): string {
  try { return new URL(input).hostname.slice(0, 253); } catch { return 'invalid-url'; }
}

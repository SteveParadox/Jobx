import { getDb } from '@/db';
import * as s from '@/db/schema';
import { crawlCareerSeed } from './career-crawler';
import { log } from '@/lib/log';
import { and, desc, eq, gte, lt, sql } from 'drizzle-orm';

const MAX_SEEDS = 25;
const MAX_CANDIDATES_PER_RUN = 1000;
const MAX_INTERVAL_MINUTES = 10080;

export async function runConfiguredSeedDiscovery(
  seedList: string,
  intervalMinutes = 60,
  now = new Date(),
  force = false,
) {
  const parsedSeeds = [...new Set(seedList.split(/[\n,;]+/).map((item) => item.trim()).filter(Boolean))];
  if (!parsedSeeds.length) return { skipped: true, reason: 'no_configured_seeds', seedsSeen: 0 };
  if (parsedSeeds.length > MAX_SEEDS)
    return { skipped: true, reason: 'seed_limit_exceeded', seedsSeen: parsedSeeds.length, maxSeeds: MAX_SEEDS };
  if (!Number.isFinite(intervalMinutes) || !Number.isInteger(intervalMinutes))
    return { skipped: true, reason: 'invalid_discovery_interval' };
  const seeds = parsedSeeds;

  const db = getDb();
  const interval = Math.max(15, Math.min(MAX_INTERVAL_MINUTES, intervalMinutes));
  const cutoff = new Date(now.getTime() - interval * 60_000);
  const staleRunCutoff = new Date(now.getTime() - 30 * 60_000);
  const hostBudgetRetentionCutoff = new Date(now.getTime() - 30 * 24 * 60 * 60_000);

  // Host budgets are only needed while their reservation is recent. Bound table
  // growth without deleting reservations that are still waiting to be consumed.
  await db.delete(s.sourceHostBudgets)
    .where(lt(s.sourceHostBudgets.nextRequestAt, hostBudgetRetentionCutoff));

  // Serialize the check-and-create section across all workers sharing PostgreSQL.
  // The transaction-scoped lock is released after the new running row is committed.
  const startResult = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(731904225)`);
    await tx.update(s.discoveryRuns).set({
      status: 'failed', error: 'Discovery run exceeded the 30-minute safety window', finishedAt: now,
    }).where(and(eq(s.discoveryRuns.status, 'running'), lt(s.discoveryRuns.startedAt, staleRunCutoff)));
    const [runningRun] = await tx.select({ id: s.discoveryRuns.id })
      .from(s.discoveryRuns)
      .where(eq(s.discoveryRuns.status, 'running'))
      .orderBy(desc(s.discoveryRuns.startedAt)).limit(1);
    if (runningRun)
      return { skipped: true as const, reason: 'discovery_run_already_in_progress', runId: runningRun.id };

    // Only successful runs consume the configured interval. A failed run must
    // be eligible for the next worker tick rather than suppressing discovery.
    const [recentRun] = await tx.select({ id: s.discoveryRuns.id })
      .from(s.discoveryRuns)
      .where(and(
        gte(s.discoveryRuns.startedAt, cutoff),
        eq(s.discoveryRuns.status, 'completed'),
      ))
      .orderBy(desc(s.discoveryRuns.startedAt)).limit(1);
    if (recentRun && !force)
      return { skipped: true as const, reason: 'discovery_interval_not_elapsed', runId: recentRun.id };

    const [run] = await tx.insert(s.discoveryRuns).values({
      trigger: force ? 'manual' : 'configured_seeds', status: 'running', seedsSeen: seeds.length,
    }).returning({ id: s.discoveryRuns.id });
    return { run };
  });
  if ('skipped' in startResult) return startResult;
  const run = startResult.run;

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
            id: s.discoveryCandidates.id,
          }).from(s.discoveryCandidates)
            .where(eq(s.discoveryCandidates.canonicalUrl, candidate.canonicalUrl)).limit(1);
          const incoming = candidate.evidence[0];
          await db.insert(s.discoveryCandidates).values({
            canonicalUrl: candidate.canonicalUrl, hostname: candidate.hostname,
            provider: candidate.provider, boardToken: candidate.boardToken,
            state: candidate.state, requiresPermissionReview: true,
            evidence: candidate.evidence, lastObservedAt: now,
          }).onConflictDoUpdate({
            target: s.discoveryCandidates.canonicalUrl,
            set: {
              provider: candidate.provider, boardToken: candidate.boardToken,
              // Merge against the current row in PostgreSQL, not a stale read made
              // before the upsert. This preserves evidence when workers race.
              evidence: sql`CASE
                WHEN EXISTS (
                  SELECT 1
                  FROM jsonb_array_elements(COALESCE(${s.discoveryCandidates.evidence}, '[]'::jsonb)) AS existing(item)
                  WHERE existing.item->>'kind' = ${incoming.kind}
                    AND existing.item->>'url' = ${incoming.url}
                    AND existing.item->>'detail' = ${incoming.detail}
                ) THEN ${s.discoveryCandidates.evidence}
                ELSE (
                  SELECT COALESCE(jsonb_agg(retained.item ORDER BY retained.ordinality), '[]'::jsonb)
                  FROM (
                    SELECT item, ordinality
                    FROM jsonb_array_elements(
                      COALESCE(${s.discoveryCandidates.evidence}, '[]'::jsonb) || ${JSON.stringify([incoming])}::jsonb
                    ) WITH ORDINALITY AS appended(item, ordinality)
                    ORDER BY ordinality DESC
                    LIMIT 25
                  ) AS retained
                )
              END`,
              lastObservedAt: now,
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

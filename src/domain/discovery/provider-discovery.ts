import { getDb } from '@/db';
import * as s from '@/db/schema';
import { federatedSearch } from '@/domain/federated-search';
import { providerStorageAllowed } from '@/domain/external-lead-tokens';
import { audit } from '@/domain/jobs';
import { admin, type Actor } from '@/lib/auth';
import { env } from '@/lib/config';
import { AppError } from '@/lib/errors';
import { digest } from '@/lib/security';
import { and, desc, eq, lt, notInArray, sql } from 'drizzle-orm';
import { z } from 'zod';

export const autonomousDiscoverySeedSchema = z.array(z.object({
  q: z.string().trim().min(2).max(120),
  provider: z.enum(['usajobs', 'jooble']),
  location: z.string().trim().max(120).default(''),
  market: z.string().regex(/^[a-z]{2}$/).optional(),
}).strict()).min(1).max(10);

export function configuredProviderDiscoverySeeds(input: string) {
  const seeds = autonomousDiscoverySeedSchema.parse(JSON.parse(input) as unknown);
  // Avoid silently removing industries, countries, or terms. Seeds are operator choices.
  return seeds;
}
export function discoveryLeadFingerprint(item: {
  provider: string; url: string; title: string; company: string; location: string; excerpt: string;
}) {
  return {
    key: digest(item.provider + '\n' + item.url),
    content: digest([item.title, item.company, item.location, item.excerpt].join('\n')),
  };
}

export async function purgeUnlicensedProviderDiscovery() {
  const permitted = ['usajobs','jooble'].filter(providerStorageAllowed);
  if (!permitted.length) return getDb().delete(s.externalDiscoveryLeads);
  return getDb().delete(s.externalDiscoveryLeads)
    .where(notInArray(s.externalDiscoveryLeads.provider, permitted));
}

/**
 * Bounded, operator-configured API discovery. No candidate profile, user account,
 * arbitrary internet crawl, employer creation or public job publication involved.
 */
export async function runAutonomousProviderDiscovery(now = new Date()) {
  if (!env.JOB_AUTONOMOUS_PROVIDER_DISCOVERY_ENABLED)
    return { skipped: true, reason: 'disabled' };
  if (!env.JOB_AUTONOMOUS_PROVIDER_DISCOVERY_SEEDS?.trim())
    return { skipped: true, reason: 'no_provider_seeds' };
  const seeds = configuredProviderDiscoverySeeds(env.JOB_AUTONOMOUS_PROVIDER_DISCOVERY_SEEDS);
  const db = getDb();
  const start = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(51704033)`);
    await tx.update(s.externalDiscoveryRuns)
      .set({ status: 'failed', error: 'Stale worker run expired', finishedAt: now })
      .where(and(
        eq(s.externalDiscoveryRuns.status, 'running'),
        lt(s.externalDiscoveryRuns.startedAt, new Date(now.getTime() - 60 * 60000)),
      ));
    const [running] = await tx.select({ id: s.externalDiscoveryRuns.id })
      .from(s.externalDiscoveryRuns)
      .where(eq(s.externalDiscoveryRuns.status, 'running')).limit(1);
    if (running) return { skipped: true as const, reason: 'already_running' };
    const [run] = await tx.insert(s.externalDiscoveryRuns)
      .values({ status: 'running', queries: seeds.length, startedAt: now })
      .returning({ id: s.externalDiscoveryRuns.id });
    return { run };
  });
  if ('skipped' in start) return start;
  let found = 0;
  let updated = 0;
  let failures = 0;
  const runId = start.run.id;
  try {
    for (const seed of seeds) {
      if (!providerStorageAllowed(seed.provider)) {
        failures++;
        continue;
      }
      try {
        const result = await federatedSearch({
          q: seed.q,
          location: seed.location,
          provider: seed.provider,
          ...(seed.market ? { market: seed.market } : {}),
          page: 1,
        });
        const source = result.providers.find((entry) => entry.provider === seed.provider);
        if (source?.state !== 'ok') {
          failures++;
          continue;
        }
        // Only provider-licensed leads, never existing public Jobx postings.
        for (const item of result.items.slice(0, 30)) {
          if (item.provenance !== 'external_api' || item.provider !== seed.provider)
            continue;
          const fingerprints = discoveryLeadFingerprint(item);
          await db.transaction(async (tx) => {
            const [current] = await tx.select({
              leadKey: s.externalDiscoveryLeads.leadKey,
              contentFingerprint: s.externalDiscoveryLeads.contentFingerprint,
              state: s.externalDiscoveryLeads.state,
            }).from(s.externalDiscoveryLeads)
              .where(eq(s.externalDiscoveryLeads.leadKey, fingerprints.key))
              .for('update');
            const changed = Boolean(current && current.contentFingerprint !== fingerprints.content);
            if (current) {
              await tx.update(s.externalDiscoveryLeads).set({
                title: item.title,
                company: item.company,
                location: item.location,
                searchQuery: seed.q,
                contentFingerprint: fingerprints.content,
                lastSeenAt: now,
                ...(changed ? {
                  lastChangedAt: now,
                  state: current.state === 'rejected' ? 'rejected' : 'pending',
                  reviewedAt: null,
                  reviewedBy: null,
                  reviewNote: null,
                } : {}),
              }).where(eq(s.externalDiscoveryLeads.leadKey, fingerprints.key));
              if (changed) updated++;
            } else {
              await tx.insert(s.externalDiscoveryLeads).values({
                leadKey: fingerprints.key,
                provider: item.provider,
                title: item.title,
                company: item.company,
                location: item.location,
                url: item.url,
                searchQuery: seed.q,
                contentFingerprint: fingerprints.content,
                state: 'pending',
                firstSeenAt: now,
                lastSeenAt: now,
                lastChangedAt: now,
              });
              found++;
            }
          });
        }
      } catch {
        // No provider URLs or secret-bearing error payloads in database/logs.
        failures++;
      }
    }
    await db.update(s.externalDiscoveryRuns).set({
      status: failures ? 'partial' : 'completed',
      found, updated, failures, finishedAt: new Date(),
      error: failures ? 'Some sources unavailable or not licensed; review settings' : null,
    }).where(eq(s.externalDiscoveryRuns.id, runId));
    return { runId, status: failures ? 'partial' : 'completed', found, updated, failures };
  } catch {
    await db.update(s.externalDiscoveryRuns).set({
      status: 'failed', found, updated, failures,
      error: 'Provider discovery processing failed', finishedAt: new Date(),
    }).where(eq(s.externalDiscoveryRuns.id, runId));
    throw new Error('Provider discovery processing failed');
  }
}

/** Human review only. Approval here is never source permission or job publication. */
export async function reviewExternalDiscoveryLead(
  actor: Actor,
  key: string,
  state: 'reviewed' | 'rejected',
  note: string,
) {
  admin(actor);
  if (!/^[a-f0-9]{64}$/.test(key))
    throw new AppError(400, 'Invalid lead identity');
  return getDb().transaction(async (tx) => {
    const [row] = await tx.update(s.externalDiscoveryLeads)
      .set({ state, reviewedAt: new Date(), reviewedBy: actor.id, reviewNote: note })
      .where(eq(s.externalDiscoveryLeads.leadKey, key))
      .returning({ leadKey: s.externalDiscoveryLeads.leadKey });
    if (!row) throw new AppError(404, 'External lead not found');
    await audit(tx, actor.id, 'discovery.external_lead_reviewed', key, { state, note });
    return { reviewed: true, leadKey: key, state };
  });
}

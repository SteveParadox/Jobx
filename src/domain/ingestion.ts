import { getDb } from '@/db';
import * as s from '@/db/schema';
import { fetchFeed, type FeedJob } from '@/integrations/feeds';
import { log } from '@/lib/log';
import { plainText, publicUrl, sanitizeDescription, slugify } from '@/lib/security';
import { and, desc, eq, lt, sql } from 'drizzle-orm';
import { fingerprint, queueIndex } from './jobs';
export async function syncSource(
  sourceId: string,
  fetcher: typeof fetch = fetch,
  suppliedRows?: FeedJob[],
) {
  const db = getDb();
  const [source] = await db.select().from(s.sources).where(eq(s.sources.id, sourceId));
  if (!source?.enabled) throw new Error('Source is disabled or missing');
  if (
    !source.permissionEvidence ||
    !['title', 'description', 'location', 'application'].every((v) =>
      source.permittedFields.includes(v),
    )
  )
    throw new Error('Source permission must cover displayed fields');
  const [run] = await db.insert(s.syncRuns).values({ sourceId, status: 'fetching' }).returning();
  try {
    if (source.provider.startsWith('manual_') && !suppliedRows)
      throw new Error('Manual sources require an authorized complete upload');
    if (!source.provider.startsWith('manual_') && suppliedRows)
      throw new Error('ATS snapshots must come from the configured provider');
    const rows = suppliedRows ?? (await fetchFeed(source.provider, source.boardToken, fetcher));
    if (new Set(rows.map((v) => v.externalId)).size !== rows.length)
      throw new Error('Duplicate provider IDs in snapshot');
    for (const row of rows) validateFeedJob(row);
    await db.transaction(async (tx) => {
      // Network I/O precedes locking. A later run never reconciles over a newer successful snapshot.
      const [locked] = await tx
        .select()
        .from(s.sources)
        .where(eq(s.sources.id, sourceId))
        .for('update');
      if (!locked.enabled) throw new Error('Source was disabled while fetching');
      if (locked.lastSuccessAt && locked.lastSuccessAt > run.startedAt) {
        await tx
          .update(s.syncRuns)
          .set({ status: 'superseded', finishedAt: new Date() })
          .where(eq(s.syncRuns.id, run.id));
        return;
      }
      const [company] = await tx
        .select()
        .from(s.employers)
        .where(eq(s.employers.id, source.employerId))
        .for('update');
      const seen = new Set<string>();
      for (const row of rows) {
        seen.add(row.externalId);
        const d = row.data;
        const html = sanitizeDescription(d.descriptionHtml);
        const text = plainText(html);
        const fp = fingerprint(
          d.title,
          d.locationLabel,
          text + (source.provider.startsWith('manual_') ? JSON.stringify(d) : ''),
          d.applyUrl ?? '',
        );
        const [mapping] = await tx
          .select()
          .from(s.mappings)
          .where(and(eq(s.mappings.sourceId, sourceId), eq(s.mappings.externalId, row.externalId)))
          .for('update');
        let job = mapping
          ? (await tx.select().from(s.jobs).where(eq(s.jobs.id, mapping.jobId)))[0]
          : undefined;
        // Cross-source aliases need the same employer, URL and full normalized fingerprint.
        // Distinct requisitions within one source never merge based on a shared careers URL.
        if (!job) {
          const [match] = await tx
            .select()
            .from(s.jobs)
            .where(
              and(
                eq(s.jobs.employerId, source.employerId),
                eq(s.jobs.applyUrl, d.applyUrl!),
                eq(s.jobs.fingerprint, fp),
                sql`not exists(select 1 from source_job_mappings where job_id=${s.jobs.id} and source_id=${sourceId})`,
              ),
            )
            .limit(1);
          job = match;
        }
        const now = new Date();
        if (!job) {
          [job] = await tx
            .insert(s.jobs)
            .values({
              ...d,
              expiresAt: d.expiresAt ? new Date(d.expiresAt) : null,
              employerId: source.employerId,
              title: d.title,
              slug: slugify(d.title),
              descriptionHtml: html,
              descriptionText: text,
              locationLabel: d.locationLabel,
              workplace: d.workplace,
              applyUrl: d.applyUrl,
              fingerprint: fp,
              status: 'pending',
              originalPostedAt: d.originalPostedAt ? new Date(d.originalPostedAt) : null,
              lastVerifiedAt: now,
              isDemo: company.isDemo,
            })
            .returning();
          // Unknown physical/remote semantics require review even when auto-publication is allowed.
        } else if (job.fingerprint !== fp) {
          [job] = await tx
            .update(s.jobs)
            .set({
              ...(source.provider.startsWith('manual_')
                ? {
                    ...d,
                    originalPostedAt: d.originalPostedAt
                      ? new Date(d.originalPostedAt)
                      : job.originalPostedAt,
                    expiresAt: d.expiresAt ? new Date(d.expiresAt) : null,
                  }
                : {}),
              title: d.title,
              slug: slugify(d.title),
              descriptionHtml: html,
              descriptionText: text,
              locationLabel: d.locationLabel,
              applyUrl: d.applyUrl,
              fingerprint: fp,
              status: 'pending',
              version: job.version + 1,
              updatedAt: now,
              lastVerifiedAt: now,
            })
            .where(eq(s.jobs.id, job.id))
            .returning();
          await tx
            .insert(s.jobHistory)
            .values({ jobId: job.id, change: { type: 'source_update', sourceId } });
          await queueIndex(tx, job, 'URL_DELETED');
        } else {
          await tx.update(s.jobs).set({ lastVerifiedAt: now }).where(eq(s.jobs.id, job.id));
        }
        // No source payload is allowed to invent a country or remote eligibility. Reopening is moderated.
        await tx
          .insert(s.mappings)
          .values({
            sourceId,
            externalId: row.externalId,
            jobId: job.id,
            sourceUrl: row.sourceUrl,
            rawPayload: row.raw,
            lastObservedAt: now,
          })
          .onConflictDoUpdate({
            target: [s.mappings.sourceId, s.mappings.externalId],
            set: {
              rawPayload: row.raw,
              lastObservedAt: now,
              missingCount: 0,
              lastMissingAt: null,
              sourceUrl: row.sourceUrl,
            },
          });
      }
      const allMappings = await tx
        .select()
        .from(s.mappings)
        .where(eq(s.mappings.sourceId, sourceId));
      for (const mapping of allMappings) {
        if (seen.has(mapping.externalId)) continue;
        // At least two complete successful snapshots, spaced by an hour, must confirm absence.
        const now = new Date();
        if (mapping.lastMissingAt && now.getTime() - mapping.lastMissingAt.getTime() < 3600000)
          continue;
        const count = mapping.missingCount + 1;
        await tx
          .update(s.mappings)
          .set({ missingCount: count, lastMissingAt: now })
          .where(eq(s.mappings.id, mapping.id));
        if (count >= 2) {
          const aliases = await tx
            .select()
            .from(s.mappings)
            .where(eq(s.mappings.jobId, mapping.jobId));
          if (aliases.every((v) => (v.id === mapping.id ? count >= 2 : v.missingCount >= 2))) {
            const [closed] = await tx
              .update(s.jobs)
              .set({
                status: 'closed',
                closedAt: now,
                updatedAt: now,
                version: sql`${s.jobs.version}+1`,
              })
              .where(and(eq(s.jobs.id, mapping.jobId), eq(s.jobs.status, 'active')))
              .returning();
            if (closed) await queueIndex(tx, closed, 'URL_DELETED');
          }
        }
      }
      await tx
        .update(s.sources)
        .set({ lastSuccessAt: new Date() })
        .where(eq(s.sources.id, sourceId));
      await tx
        .update(s.syncRuns)
        .set({ status: 'completed', count: rows.length, finishedAt: new Date() })
        .where(eq(s.syncRuns.id, run.id));
    });
    return { runId: run.id, count: rows.length };
  } catch (error) {
    const reason = error instanceof Error ? error.message.slice(0, 1000) : 'Unknown source failure';
    await db.transaction(async (tx) => {
      await tx
        .update(s.syncRuns)
        .set({ status: 'failed', error: reason, finishedAt: new Date() })
        .where(eq(s.syncRuns.id, run.id));
      await tx.insert(s.ingestionErrors).values({ runId: run.id, stage: 'snapshot', reason });
    });
    log('source_sync_failed', { sourceId, runId: run.id, reason });
    throw error;
  }
}
function validateFeedJob(row: FeedJob) {
  if (
    !row.externalId ||
    row.data.title.trim().length < 3 ||
    plainText(row.data.descriptionHtml).length < 80
  )
    throw new Error(`Malformed or incomplete source record ${row.externalId}`);
  publicUrl(row.sourceUrl);
  publicUrl(row.data.applyUrl!);
}
export async function sourceHealth() {
  return getDb()
    .select({ source: s.sources, lastRun: s.syncRuns })
    .from(s.sources)
    .leftJoin(
      s.syncRuns,
      sql`${s.syncRuns.id}=(select id from source_sync_runs where source_id=${s.sources.id} order by started_at desc limit 1)`,
    )
    .orderBy(desc(s.sources.createdAt));
}
export async function pruneRawPayloads() {
  await getDb()
    .update(s.mappings)
    .set({ rawPayload: null })
    .where(lt(s.mappings.lastObservedAt, new Date(Date.now() - 30 * 86400000)));
}

export async function setSourceEnabled(actorId: string, id: string, enabled: boolean) {
  const db = getDb();
  return db.transaction(async (tx) => {
    const [source] = await tx.select().from(s.sources).where(eq(s.sources.id, id)).for('update');
    if (!source) throw new Error('Source not found');
    await tx.update(s.sources).set({ enabled }).where(eq(s.sources.id, id));
    if (!enabled) {
      const mapped = await tx
        .select({ jobId: s.mappings.jobId })
        .from(s.mappings)
        .where(eq(s.mappings.sourceId, id));
      for (const { jobId } of mapped) {
        const aliases = await tx
          .select()
          .from(s.mappings)
          .innerJoin(s.sources, eq(s.sources.id, s.mappings.sourceId))
          .where(and(eq(s.mappings.jobId, jobId), eq(s.sources.enabled, true)));
        if (!aliases.length) {
          const [job] = await tx
            .update(s.jobs)
            .set({ status: 'paused', version: sql`${s.jobs.version}+1`, updatedAt: new Date() })
            .where(and(eq(s.jobs.id, jobId), eq(s.jobs.status, 'active')))
            .returning();
          if (job) {
            await queueIndex(tx, job, 'URL_DELETED');
            await tx
              .insert(s.jobHistory)
              .values({ jobId, actorId, change: { reason: 'source_disabled', sourceId: id } });
            await tx
              .update(s.employers)
              .set({ updatedAt: new Date() })
              .where(eq(s.employers.id, job.employerId));
          }
        }
      }
    }
    await tx
      .insert(s.auditLogs)
      .values({ actorId, action: 'source.enabled', entityId: id, detail: { enabled } });
  });
}

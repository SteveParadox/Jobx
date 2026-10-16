import { getDb } from '@/db';
import * as s from '@/db/schema';
import { sourceAdapter } from '@/integrations/sources/adapters';
import {
  SourceError,
  sourceConfigSchema,
  type FeedJob,
  type Snapshot,
} from '@/integrations/sources/contracts';
import { createSourceContext, fixtureTransport, type Transport } from '@/integrations/sources/http';
import { checkApplicationLinks } from '@/integrations/sources/link-checks';
import { canonicalApplicationUrl, validateSnapshot } from '@/integrations/sources/normalize';
import { log } from '@/lib/log';
import { digest, plainText, sanitizeDescription, slugify } from '@/lib/security';
import { and, desc, eq, inArray, lt, sql } from 'drizzle-orm';
import { queueIndex } from './jobs';
import { assertSourceApproved, changeSourceEnabled } from './source-management';

export type SyncOptions = {
  taskId?: string;
  testOnly?: boolean;
  signal?: AbortSignal;
  transport?: Transport;
  pace?: (host: string, interval: number, signal: AbortSignal) => Promise<void>;
  checkCancelled?: () => Promise<void>;
};
function rawRetention(value: unknown): unknown {
  const text = JSON.stringify(value ?? null);
  return text.length <= 25000
    ? (value ?? null)
    : { truncated: true, preview: text.slice(0, 24000) };
}
function contentFingerprint(data: FeedJob['data']) {
  const values = {
    ...data,
    descriptionHtml: plainText(data.descriptionHtml),
    originalPostedAt: undefined,
  };
  return digest(
    JSON.stringify(
      Object.fromEntries(
        Object.entries(values)
          .filter(([, value]) => value !== undefined)
          .sort(([a], [b]) => a.localeCompare(b)),
      ),
    ),
  );
}
function permittedData(row: FeedJob, fields: string[]) {
  const data = { ...row.data };
  if (!fields.includes('date')) {
    data.originalPostedAt = null;
    data.expiresAt = null;
  }
  if (!fields.includes('salary')) {
    data.salaryMin = null;
    data.salaryMax = null;
    data.currency = null;
    data.salaryPeriod = null;
  }
  if (!fields.includes('skills')) data.skills = [];
  if (!fields.includes('employment')) data.employmentType = null;
  if (!fields.includes('experience')) {
    data.experienceMin = null;
    data.seniority = undefined;
    data.education = undefined;
  }
  return data;
}
export async function syncSource(
  sourceId: string,
  fetcher: typeof fetch = fetch,
  suppliedRows?: FeedJob[],
  options: SyncOptions = {},
) {
  const db = getDb();
  const started = Date.now();
  const leaseToken = crypto.randomUUID();
  const { source, run } = await db.transaction(async (tx) => {
    const [source] = await tx
      .select()
      .from(s.sources)
      .where(eq(s.sources.id, sourceId))
      .for('update');
    if (!source || (!source.enabled && !options.testOnly))
      throw new SourceError('DISABLED', 'Source is disabled or missing');
    assertSourceApproved(source);
    if (source.syncLeaseUntil && source.syncLeaseUntil > new Date())
      throw new SourceError('BUSY', 'Another worker holds the source lease', true, 30000);
    await tx
      .update(s.sources)
      .set({ syncLeaseToken: leaseToken, syncLeaseUntil: new Date(Date.now() + 600000) })
      .where(eq(s.sources.id, sourceId));
    const [run] = await tx
      .insert(s.syncRuns)
      .values({ sourceId, taskId: options.taskId, revision: source.revision, status: 'fetching' })
      .returning();
    return { source, run };
  });
  const stats = { imported: 0, updated: 0, closed: 0, duplicates: 0, quarantined: 0, protected: 0 };
  try {
    const manual = source.provider.startsWith('manual_');
    if (manual !== Boolean(suppliedRows))
      throw new SourceError(
        'SNAPSHOT_ORIGIN',
        manual
          ? 'Manual source needs a complete authorized upload'
          : 'Network source snapshots must come from the approved endpoint',
      );
    const config = sourceConfigSchema.parse(source.config);
    const context = manual
      ? null
      : createSourceContext(source, {
          ...options,
          transport:
            options.transport ?? (fetcher !== fetch ? fixtureTransport(fetcher) : undefined),
        });
    let snapshot: Snapshot = manual
      ? { records: suppliedRows!, rejected: [], complete: true, requests: 0 }
      : await sourceAdapter(source.provider).fetch(context!);
    snapshot = validateSnapshot(snapshot, { source, config });
    if (context)
      snapshot = await checkApplicationLinks(snapshot, context, {
        transport: options.transport ?? (fetcher !== fetch ? fixtureTransport(fetcher) : undefined),
        pace: options.pace,
      });
    stats.quarantined = snapshot.rejected.filter(
      (row) => !row.reason.startsWith('EXCLUDED:'),
    ).length;
    if (options.checkCancelled) await options.checkCancelled();
    await db
      .update(s.syncRuns)
      .set({ status: 'persisting', requests: snapshot.requests })
      .where(eq(s.syncRuns.id, run.id));
    await db.transaction(async (tx) => {
      const [locked] = await tx
        .select()
        .from(s.sources)
        .where(eq(s.sources.id, sourceId))
        .for('update');
      if (
        !locked ||
        locked.syncLeaseToken !== leaseToken ||
        locked.revision !== source.revision ||
        (!locked.enabled && !options.testOnly)
      )
        throw new SourceError('CANCELLED', 'Source changed or was disabled while fetching');
      assertSourceApproved(locked);
      if (options.taskId) {
        const [task] = await tx
          .select()
          .from(s.ingestionTasks)
          .where(eq(s.ingestionTasks.id, options.taskId));
        if (!task || task.cancelRequested || task.status !== 'running')
          throw new SourceError('CANCELLED', 'Task was cancelled before persistence');
      }
      for (const rejected of snapshot.rejected)
        await tx.insert(s.ingestionErrors).values({
          runId: run.id,
          externalId: rejected.externalId,
          stage: 'normalize',
          reason: rejected.reason.slice(0, 1000),
          rawPayload: rawRetention(rejected.raw),
          disposition: rejected.reason.startsWith('EXCLUDED:') ? 'excluded' : 'quarantined',
        });
      if (options.testOnly) {
        const valid = !stats.quarantined;
        await tx
          .update(s.sources)
          .set({
            lastTestAt: new Date(),
            validatedRevision: valid ? source.revision : null,
            syncLeaseToken: null,
            syncLeaseUntil: null,
            health: valid ? 'validated' : 'degraded',
          })
          .where(eq(s.sources.id, sourceId));
        await tx
          .update(s.syncRuns)
          .set({
            status: valid ? 'tested' : 'partial',
            count: snapshot.records.length,
            complete: snapshot.complete,
            ...stats,
            durationMs: Date.now() - started,
            finishedAt: new Date(),
          })
          .where(eq(s.syncRuns.id, run.id));
        return;
      }
      const [company] = await tx
        .select()
        .from(s.employers)
        .where(eq(s.employers.id, source.employerId))
        .for('update');
      if (!company || company.disabled || company.verificationStatus !== 'verified')
        throw new SourceError('EMPLOYER', 'Employer is not verified and enabled');
      const seen = new Set<string>();
      for (const row of snapshot.records) {
        if (Date.now() - started > 180000)
          throw new SourceError(
            'TIMEOUT',
            'Ingestion exceeded its bounded processing deadline',
            true,
          );
        if (options.taskId && seen.size % 25 === 0) {
          const [task] = await tx
            .select()
            .from(s.ingestionTasks)
            .where(eq(s.ingestionTasks.id, options.taskId));
          if (!task || task.cancelRequested || task.status !== 'running')
            throw new SourceError('CANCELLED', 'Task cancelled during normalization/persistence');
        }
        seen.add(row.externalId);
        const d = permittedData(row, source.permittedFields);
        const now = new Date();
        const html = sanitizeDescription(d.descriptionHtml);
        const text = plainText(html);
        const fp = contentFingerprint(d);
        const [mapping] = await tx
          .select()
          .from(s.mappings)
          .where(and(eq(s.mappings.sourceId, sourceId), eq(s.mappings.externalId, row.externalId)))
          .for('update');
        let job = mapping
          ? (await tx.select().from(s.jobs).where(eq(s.jobs.id, mapping.jobId)).for('update'))[0]
          : undefined;
        let alias = false;
        if (!job) {
          // Same employer, same application URL, compatible title/location and full description.
          // Two requisitions within one source are never merged based on a shared careers URL.
          const candidates = await tx
            .select()
            .from(s.jobs)
            .where(
              and(
                eq(s.jobs.employerId, source.employerId),
                eq(s.jobs.applyUrl, canonicalApplicationUrl(d.applyUrl!)),
                sql`similarity(${s.jobs.title},${d.title})>0.8`,
                sql`lower(${s.jobs.locationLabel})=lower(${d.locationLabel})`,
                sql`not exists(select 1 from source_job_mappings where job_id=${s.jobs.id} and source_id=${sourceId})`,
              ),
            )
            .limit(20);
          job = candidates.find(
            (candidate) =>
              plainText(candidate.descriptionHtml).toLowerCase().replace(/\s+/g, ' ').trim() ===
              text.toLowerCase().replace(/\s+/g, ' ').trim(),
          );
          alias = Boolean(job);
          if (alias) stats.duplicates++;
        }
        const deadline = d.expiresAt ? new Date(d.expiresAt) : null;
        const knownLocation =
          d.workplace === 'remote'
            ? Boolean(d.remoteCountries.length)
            : d.workplace !== 'unknown' && Boolean(d.country);
        const publish =
          source.autoPublish &&
          knownLocation &&
          (!deadline || deadline > now) &&
          (!row.linkStatus || row.linkStatus === 'reachable');
        const expired = Boolean(deadline && deadline <= now);
        const nextStatus =
          row.linkStatus === 'gone'
            ? 'closed'
            : row.linkStatus === 'unavailable'
              ? 'paused'
              : expired
                ? 'expired'
                : publish
                  ? 'active'
                  : 'pending';
        const values = {
          title: d.title,
          descriptionHtml: html,
          descriptionText: text,
          locationLabel: d.locationLabel,
          country: d.country ?? null,
          region: d.region ?? null,
          city: d.city ?? null,
          workplace: d.workplace,
          remoteCountries: d.remoteCountries,
          employmentType: d.employmentType ?? null,
          category: d.category ?? null,
          seniority: d.seniority ?? null,
          skills: d.skills,
          experienceMin: d.experienceMin ?? null,
          education: d.education ?? null,
          visaSponsorship: d.visaSponsorship ?? null,
          salaryMin: d.salaryMin ?? null,
          salaryMax: d.salaryMax ?? null,
          currency: d.currency ?? null,
          salaryPeriod: d.salaryPeriod ?? null,
          applicationMethod: 'external',
          resumeRequired: false,
          applyUrl: canonicalApplicationUrl(d.applyUrl!),
          expiresAt: deadline,
          fingerprint: fp,
          lastVerifiedAt: now,
        };
        if (!job) {
          [job] = await tx
            .insert(s.jobs)
            .values({
              ...values,
              employerId: source.employerId,
              sourceOwnerId: sourceId,
              slug: slugify(d.title),
              status: nextStatus,
              isDemo: company.isDemo,
              originalPostedAt: d.originalPostedAt ? new Date(d.originalPostedAt) : null,
              publishedAt: publish ? now : null,
              closedAt: expired || row.linkStatus === 'gone' ? now : null,
            })
            .returning();
          stats.imported++;
          if (['closed', 'expired'].includes(job.status)) stats.closed++;
          await tx
            .insert(s.jobHistory)
            .values({ jobId: job.id, change: { type: 'source_created', sourceId, runId: run.id } });
          if (job.status === 'active') await queueIndex(tx, job, 'URL_UPDATED');
        } else if (job.sourceOwnerId !== sourceId) {
          // Employer-managed records and other authoritative sources keep control of the public copy.
          stats.protected++;
        } else if (
          job.fingerprint !== fp ||
          (job.status !== nextStatus &&
            (['closed', 'expired', 'paused'].includes(job.status) ||
              expired ||
              row.linkStatus === 'gone' ||
              row.linkStatus === 'unavailable'))
        ) {
          const previous = job;
          const status = nextStatus;
          [job] = await tx
            .update(s.jobs)
            .set({
              ...values,
              status,
              version: job.version + 1,
              updatedAt: now,
              originalPostedAt:
                job.originalPostedAt ?? (d.originalPostedAt ? new Date(d.originalPostedAt) : null),
              publishedAt: status === 'active' ? (job.publishedAt ?? now) : job.publishedAt,
              closedAt: expired || row.linkStatus === 'gone' ? now : null,
            })
            .where(eq(s.jobs.id, job.id))
            .returning();
          stats.updated++;
          if (['closed', 'expired'].includes(job.status) && previous.status !== job.status)
            stats.closed++;
          await tx.insert(s.jobHistory).values({
            jobId: job.id,
            change: {
              type: 'source_update',
              sourceId,
              previousVersion: previous.version,
              runId: run.id,
              applicationLinkStatus: row.linkStatus ?? null,
            },
          });
          await queueIndex(tx, job, job.status === 'active' ? 'URL_UPDATED' : 'URL_DELETED');
        } else {
          await tx.update(s.jobs).set({ lastVerifiedAt: now }).where(eq(s.jobs.id, job.id));
        }
        await tx
          .insert(s.mappings)
          .values({
            sourceId,
            externalId: row.externalId,
            jobId: job.id,
            sourceUrl: row.sourceUrl,
            rawPayload: rawRetention(row.raw),
            normalizedPayload: {
              ...d,
              ...(row.linkStatus
                ? { linkVerification: { status: row.linkStatus, verifiedAt: now.toISOString() } }
                : {}),
            },
            sourcePostedAt: row.sourcePostedAt ? new Date(row.sourcePostedAt) : null,
            lastObservedAt: now,
          })
          .onConflictDoUpdate({
            target: [s.mappings.sourceId, s.mappings.externalId],
            set: {
              sourceUrl: row.sourceUrl,
              rawPayload: rawRetention(row.raw),
              normalizedPayload: {
                ...d,
                ...(row.linkStatus
                  ? { linkVerification: { status: row.linkStatus, verifiedAt: now.toISOString() } }
                  : {}),
              },
              sourcePostedAt: row.sourcePostedAt ? new Date(row.sourcePostedAt) : null,
              lastObservedAt: now,
              missingCount: 0,
              lastMissingAt: null,
              firstMissingAt: null,
            },
          });
      }
      if (snapshot.complete) {
        const mappings = await tx
          .select()
          .from(s.mappings)
          .where(eq(s.mappings.sourceId, sourceId));
        for (const mapping of mappings) {
          if (seen.has(mapping.externalId)) continue;
          const now = new Date();
          if (
            mapping.lastMissingAt &&
            now.getTime() - mapping.lastMissingAt.getTime() < source.missingGraceMinutes * 60000
          )
            continue;
          const count = mapping.missingCount + 1;
          await tx
            .update(s.mappings)
            .set({
              missingCount: count,
              firstMissingAt: mapping.firstMissingAt ?? now,
              lastMissingAt: now,
            })
            .where(eq(s.mappings.id, mapping.id));
          if (count < source.missingConfirmations) continue;
          const aliases = await tx
            .select({ mapping: s.mappings, source: s.sources })
            .from(s.mappings)
            .innerJoin(s.sources, eq(s.sources.id, s.mappings.sourceId))
            .where(eq(s.mappings.jobId, mapping.jobId));
          const allMissing = aliases
            .filter((alias) => alias.source.enabled && alias.source.approvalStatus === 'approved')
            .every(
              (alias) =>
                (alias.mapping.id === mapping.id ? count : alias.mapping.missingCount) >=
                alias.source.missingConfirmations,
            );
          if (!allMissing) continue;
          const [closed] = await tx
            .update(s.jobs)
            .set({
              status: 'closed',
              closedAt: now,
              updatedAt: now,
              version: sql`${s.jobs.version}+1`,
            })
            .where(
              and(
                eq(s.jobs.id, mapping.jobId),
                eq(s.jobs.sourceOwnerId, sourceId),
                inArray(s.jobs.status, ['active', 'pending', 'paused']),
              ),
            )
            .returning();
          if (closed) {
            stats.closed++;
            await queueIndex(tx, closed, 'URL_DELETED');
            await tx.insert(s.jobHistory).values({
              jobId: closed.id,
              change: {
                type: 'confirmed_source_absence',
                sourceId,
                confirmations: count,
                runId: run.id,
              },
            });
          }
        }
      }
      if (stats.imported || stats.updated || stats.closed)
        await tx
          .update(s.employers)
          .set({ updatedAt: new Date() })
          .where(eq(s.employers.id, company.id));
      await tx
        .update(s.sources)
        .set({
          ...(snapshot.complete
            ? { lastSuccessAt: new Date(), consecutiveFailures: 0 }
            : { consecutiveFailures: source.consecutiveFailures + 1 }),
          nextSyncAt: new Date(Date.now() + source.intervalMinutes * 60000),
          health: snapshot.complete ? 'healthy' : 'degraded',
          syncLeaseToken: null,
          syncLeaseUntil: null,
        })
        .where(eq(s.sources.id, sourceId));
      await tx
        .update(s.syncRuns)
        .set({
          status: snapshot.complete ? 'completed' : 'partial',
          count: snapshot.records.length,
          ...stats,
          complete: snapshot.complete,
          durationMs: Date.now() - started,
          finishedAt: new Date(),
        })
        .where(eq(s.syncRuns.id, run.id));
    });
    log('source_sync_completed', {
      sourceId,
      runId: run.id,
      complete: snapshot.complete,
      count: snapshot.records.length,
      ...stats,
    });
    return { runId: run.id, count: snapshot.records.length, complete: snapshot.complete, ...stats };
  } catch (error) {
    const cancelled = error instanceof SourceError && error.code === 'CANCELLED';
    const reason =
      error instanceof SourceError
        ? `${error.code}: ${error.message}`
        : 'Source processing or persistence failed';
    await db.transaction(async (tx) => {
      await tx
        .update(s.syncRuns)
        .set({
          status: cancelled ? 'cancelled' : 'failed',
          error: reason,
          durationMs: Date.now() - started,
          finishedAt: new Date(),
        })
        .where(eq(s.syncRuns.id, run.id));
      await tx.insert(s.ingestionErrors).values({
        runId: run.id,
        stage: 'snapshot',
        reason,
        disposition: cancelled ? 'cancelled' : 'failed',
      });
      await tx
        .update(s.sources)
        .set({
          syncLeaseToken: null,
          syncLeaseUntil: null,
          ...(cancelled
            ? {}
            : {
                lastFailureAt: new Date(),
                health: 'failing',
                consecutiveFailures: sql`${s.sources.consecutiveFailures}+1`,
              }),
        })
        .where(and(eq(s.sources.id, sourceId), eq(s.sources.syncLeaseToken, leaseToken)));
    });
    log('source_sync_failed', { sourceId, runId: run.id, reason });
    throw error;
  }
}
export async function sourceHealth() {
  return getDb()
    .select({
      source: s.sources,
      lastRun: s.syncRuns,
      activeJobs: sql<number>`(select count(distinct m.job_id)::int from source_job_mappings m join jobs j on j.id=m.job_id join employers e on e.id=j.employer_id where m.source_id=${s.sources.id} and j.status='active' and (j.expires_at is null or j.expires_at>now()) and e.disabled=false and e.verification_status='verified' and ${s.sources.enabled}=true and ${s.sources.approvalStatus}='approved')`,
    })
    .from(s.sources)
    .leftJoin(
      s.syncRuns,
      sql`${s.syncRuns.id}=(select id from source_sync_runs where source_id=${s.sources.id} order by started_at desc limit 1)`,
    )
    .orderBy(desc(s.sources.createdAt));
}
export async function pruneRawPayloads() {
  const cutoff = new Date(Date.now() - 30 * 86400000);
  await getDb()
    .update(s.mappings)
    .set({ rawPayload: null })
    .where(lt(s.mappings.lastObservedAt, cutoff));
  await getDb()
    .update(s.ingestionErrors)
    .set({ rawPayload: null })
    .where(lt(s.ingestionErrors.createdAt, cutoff));
  await getDb()
    .update(s.ingestionTasks)
    .set({ payload: null })
    .where(
      and(
        lt(s.ingestionTasks.createdAt, cutoff),
        inArray(s.ingestionTasks.status, ['completed', 'failed', 'cancelled']),
      ),
    );
}
export const setSourceEnabled = changeSourceEnabled;

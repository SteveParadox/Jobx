import { getDb } from '@/db';
import * as s from '@/db/schema';
import { sourceAdapter } from '@/integrations/sources/adapters';
import { sourceConfigSchema, SourceError, type Source } from '@/integrations/sources/contracts';
import { admin, type Actor } from '@/lib/auth';
import { AppError, requireValue } from '@/lib/errors';
import { publicUrl } from '@/lib/security';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { audit, queueIndex, type Tx } from './jobs';
import { sourceSchema } from './validation';

export function sourceApproved(source: Source) {
  return (
    source.approvalStatus === 'approved' &&
    Boolean(source.permissionEvidence) &&
    (!source.authorizationExpiresAt || source.authorizationExpiresAt > new Date()) &&
    ['title', 'description', 'location', 'application'].every((field) =>
      source.permittedFields.includes(field),
    )
  );
}
export function assertSourceApproved(source: Source) {
  if (!sourceApproved(source))
    throw new SourceError(
      'NOT_APPROVED',
      'Source approval and current redistribution permission are required',
    );
}
function values(input: unknown) {
  const data = sourceSchema.parse(input);
  for (const host of data.applicationHostnames)
    if (new URL(publicUrl('https://' + host)).hostname !== host)
      throw new AppError(400, 'Application hostnames must be exact public DNS names');
  const discovered = data.provider.startsWith('manual_')
    ? null
    : sourceAdapter(data.provider).discover({
        boardToken: data.boardToken,
        endpointUrl: data.endpointUrl ?? null,
      });
  const endpointUrl = discovered ? publicUrl(discovered) : null;
  if (
    endpointUrl &&
    [...new URL(endpointUrl).searchParams.keys()].some((key) =>
      /^(?:api[-_]?key|token|access_token|secret|signature|auth|password)$/i.test(key),
    )
  )
    throw new AppError(
      400,
      'Keep source credentials in the worker secret manager, not endpoint URLs',
    );
  if (
    data.provider.match(/^(greenhouse|lever|lever_eu|ashby)$/) &&
    data.endpointUrl &&
    data.endpointUrl !== endpointUrl
  )
    throw new AppError(400, 'ATS endpoints are fixed by the provider and board identifier');
  return {
    ...data,
    endpointUrl,
    approvedHostname: endpointUrl ? new URL(endpointUrl).hostname : null,
    authorizationExpiresAt: data.authorizationExpiresAt
      ? new Date(data.authorizationExpiresAt)
      : null,
  };
}
async function pauseOwned(tx: Tx, sourceId: string, actorId: string | null, reason: string) {
  const jobs = await tx
    .select()
    .from(s.jobs)
    .where(
      and(
        eq(s.jobs.sourceOwnerId, sourceId),
        inArray(s.jobs.status, ['active', 'closed', 'expired']),
      ),
    )
    .for('update');
  for (const job of jobs) {
    const [paused] = await tx
      .update(s.jobs)
      .set({ status: 'paused', version: job.version + 1, updatedAt: new Date() })
      .where(eq(s.jobs.id, job.id))
      .returning();
    await queueIndex(tx, paused, 'URL_DELETED');
    await tx
      .insert(s.jobHistory)
      .values({ jobId: job.id, actorId, change: { type: reason, sourceId } });
  }
}
export async function registerSource(
  actor: Actor,
  input: unknown,
  additionalAudit?: {
    action: string;
    metadata: Record<string, unknown>;
    validate?: (tx: Tx) => Promise<void>;
  },
) {
  admin(actor);
  const data = values(input);
  return getDb().transaction(async (tx) => {
    await additionalAudit?.validate?.(tx);
    requireValue(
      (await tx.select().from(s.employers).where(eq(s.employers.id, data.employerId)))[0],
    );
    const [source] = await tx
      .insert(s.sources)
      .values({ ...data, enabled: false, approvalStatus: 'pending' })
      .returning();
    await audit(tx, actor.id, 'source.registered', source.id, {
      provider: source.provider,
      hostname: source.approvedHostname,
    });
    if (additionalAudit)
      await audit(tx, actor.id, additionalAudit.action, source.id, additionalAudit.metadata);
    return source;
  });
}
export async function updateSource(actor: Actor, id: string, input: unknown) {
  admin(actor);
  const data = values(input);
  return getDb().transaction(async (tx) => {
    const old = requireValue(
      (await tx.select().from(s.sources).where(eq(s.sources.id, id)).for('update'))[0],
    );
    if (
      old.provider !== data.provider ||
      old.boardToken !== data.boardToken ||
      old.employerId !== data.employerId
    )
      throw new AppError(400, 'Create a new source to change provider, board or employer identity');
    const [source] = await tx
      .update(s.sources)
      .set({
        ...data,
        revision: old.revision + 1,
        approvalStatus: 'pending',
        approvedBy: null,
        approvedAt: null,
        validatedRevision: null,
        enabled: false,
        health: 'unconfigured',
        nextSyncAt: null,
      })
      .where(eq(s.sources.id, id))
      .returning();
    await tx
      .update(s.ingestionTasks)
      .set({ cancelRequested: true })
      .where(
        and(
          eq(s.ingestionTasks.sourceId, id),
          inArray(s.ingestionTasks.status, ['queued', 'running', 'retrying']),
        ),
      );
    await pauseOwned(tx, id, actor.id, 'source_configuration_changed');
    await audit(tx, actor.id, 'source.configuration_changed', id, { revision: source.revision });
    return source;
  });
}
export async function reviewSource(
  actor: Actor,
  id: string,
  status: 'approved' | 'revoked',
  evidence: string,
) {
  admin(actor);
  if (evidence.trim().length < 20 || evidence.length > 5000)
    throw new AppError(400, 'Record the source approval/revocation evidence');
  return getDb().transaction(async (tx) => {
    const source = requireValue(
      (await tx.select().from(s.sources).where(eq(s.sources.id, id)).for('update'))[0],
    );
    if (status === 'approved') {
      const company = requireValue(
        (await tx.select().from(s.employers).where(eq(s.employers.id, source.employerId)))[0],
      );
      if (company.disabled || company.verificationStatus !== 'verified')
        throw new AppError(409, 'Verify the employer before approving its source');
      if (
        !source.usageConditions ||
        !source.applicationHostnames.length ||
        !['title', 'description', 'location', 'application'].every((field) =>
          source.permittedFields.includes(field),
        )
      )
        throw new AppError(
          409,
          'Complete the source permissions, application hostnames and usage conditions first',
        );
      if (
        !source.provider.startsWith('manual_') &&
        (!source.endpointUrl || !source.approvedHostname)
      )
        throw new AppError(409, 'An approved source endpoint is required');
      sourceConfigSchema.parse(source.config);
      if (source.authorizationExpiresAt && source.authorizationExpiresAt <= new Date())
        throw new AppError(409, 'Source authorization has expired');
    }
    await tx
      .update(s.sources)
      .set({
        approvalStatus: status,
        approvedBy: actor.id,
        approvedAt: new Date(),
        ...(status === 'revoked' ? { enabled: false, health: 'disabled', nextSyncAt: null } : {}),
      })
      .where(eq(s.sources.id, id));
    if (status === 'revoked')
      await tx
        .update(s.ingestionTasks)
        .set({ cancelRequested: true })
        .where(
          and(
            eq(s.ingestionTasks.sourceId, id),
            inArray(s.ingestionTasks.status, ['queued', 'running', 'retrying']),
          ),
        );
    if (status === 'revoked') await pauseOwned(tx, id, actor.id, 'source_approval_revoked');
    await audit(tx, actor.id, 'source.' + status, id, { evidence, revision: source.revision });
    return { reviewed: true };
  });
}
export async function changeSourceEnabled(actorId: string, id: string, enabled: boolean) {
  if (!enabled)
    await getDb()
      .update(s.ingestionTasks)
      .set({ cancelRequested: true })
      .where(
        and(
          eq(s.ingestionTasks.sourceId, id),
          inArray(s.ingestionTasks.status, ['queued', 'running', 'retrying']),
        ),
      );
  return getDb().transaction(async (tx) => {
    const source = requireValue(
      (await tx.select().from(s.sources).where(eq(s.sources.id, id)).for('update'))[0],
    );
    if (enabled) {
      assertSourceApproved(source);
      if (!source.provider.startsWith('manual_') && source.validatedRevision !== source.revision)
        throw new AppError(
          409,
          'Run a successful queued source test for this configuration before enabling it',
        );
    }
    await tx
      .update(s.sources)
      .set({
        enabled,
        health: enabled ? 'ready' : 'disabled',
        nextSyncAt: enabled ? new Date() : null,
      })
      .where(eq(s.sources.id, id));
    if (!enabled) {
      await tx
        .update(s.ingestionTasks)
        .set({ cancelRequested: true })
        .where(
          and(
            eq(s.ingestionTasks.sourceId, id),
            inArray(s.ingestionTasks.status, ['queued', 'running', 'retrying']),
          ),
        );
      const owned = await tx
        .select()
        .from(s.jobs)
        .where(
          and(
            eq(s.jobs.sourceOwnerId, id),
            inArray(s.jobs.status, ['active', 'closed', 'expired']),
          ),
        )
        .for('update');
      for (const job of owned) {
        const [paused] = await tx
          .update(s.jobs)
          .set({ status: 'paused', version: job.version + 1, updatedAt: new Date() })
          .where(eq(s.jobs.id, job.id))
          .returning();
        await queueIndex(tx, paused, 'URL_DELETED');
        await tx
          .insert(s.jobHistory)
          .values({ jobId: job.id, actorId, change: { type: 'source_disabled', sourceId: id } });
      }
    }
    await audit(tx, actorId, 'source.enabled', id, { enabled });
    return { saved: true };
  });
}
export async function expireSourceAuthorizations() {
  return getDb().transaction(async (tx) => {
    const expired = await tx
      .select()
      .from(s.sources)
      .where(
        and(
          eq(s.sources.approvalStatus, 'approved'),
          sql`${s.sources.authorizationExpiresAt}<=now()`,
        ),
      )
      .limit(100)
      .for('update', { skipLocked: true });
    for (const source of expired) {
      await tx
        .update(s.sources)
        .set({
          approvalStatus: 'revoked',
          enabled: false,
          health: 'authorization_expired',
          nextSyncAt: null,
        })
        .where(eq(s.sources.id, source.id));
      await tx
        .update(s.ingestionTasks)
        .set({ cancelRequested: true })
        .where(
          and(
            eq(s.ingestionTasks.sourceId, source.id),
            inArray(s.ingestionTasks.status, ['queued', 'running', 'retrying']),
          ),
        );
      await pauseOwned(tx, source.id, null, 'source_authorization_expired');
      await audit(tx, null, 'source.authorization_expired', source.id);
    }
    return expired.length;
  });
}

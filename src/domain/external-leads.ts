import { getDb } from '@/db';
import * as s from '@/db/schema';
import type { Actor } from '@/lib/auth';
import { AppError } from '@/lib/errors';
import { digest } from '@/lib/security';
import { and, desc, eq } from 'drizzle-orm';
import { unsealExternalLead } from './external-lead-tokens';

export async function listSavedExternalLeads(actor: Actor) {
  return getDb().select().from(s.externalSavedLeads)
    .where(eq(s.externalSavedLeads.userId, actor.id))
    .orderBy(desc(s.externalSavedLeads.createdAt)).limit(100);
}
export async function saveExternalLead(actor: Actor, token: string) {
  let claim;
  try { claim = unsealExternalLead(token, actor.id); }
  catch { throw new AppError(403, 'External lead storage is not authorized or token expired'); }
  const [saved] = await getDb().insert(s.externalSavedLeads).values({
    userId: actor.id,
    provider: claim.provider,
    leadKey: digest(claim.url),
    title: claim.title,
    company: claim.company,
    location: claim.location,
    url: claim.url,
  }).onConflictDoNothing().returning({ id: s.externalSavedLeads.id });
  return { saved: true, id: saved?.id ?? null };
}
export async function updateExternalLead(
  actor: Actor, id: string,
  status: 'saved' | 'applied' | 'interviewing' | 'offer' | 'rejected' | 'closed',
) {
  const [row] = await getDb().update(s.externalSavedLeads)
    .set({ status, updatedAt: new Date() })
    .where(and(eq(s.externalSavedLeads.id, id),eq(s.externalSavedLeads.userId, actor.id)))
    .returning({ id: s.externalSavedLeads.id });
  if (!row) throw new AppError(404, 'External lead not found');
  return { updated: true };
}
export async function removeExternalLead(actor: Actor, id: string) {
  const [row] = await getDb().delete(s.externalSavedLeads)
    .where(and(eq(s.externalSavedLeads.id, id),eq(s.externalSavedLeads.userId, actor.id)))
    .returning({ id: s.externalSavedLeads.id });
  if (!row) throw new AppError(404, 'External lead not found');
  return { deleted: true };
}

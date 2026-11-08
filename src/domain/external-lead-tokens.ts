import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { env } from '@/lib/config';
import type { SearchLead } from '@/integrations/federated-providers';

const claimSchema = z.object({
  userId: z.string().min(1).max(250),
  expiresAt: z.number().int(),
  provider: z.enum(['adzuna','usajobs','jooble']),
  title: z.string().min(3).max(180),
  company: z.string().max(160),
  location: z.string().max(200),
  url: z.url().max(3000),
}).strict();
export type ExternalLeadClaim = z.infer<typeof claimSchema>;
export function providerStorageAllowed(provider: string) {
  return ['adzuna','usajobs','jooble'].includes(provider) &&
    (env.JOB_EXTERNAL_SAVE_PROVIDERS ?? '').split(',').some(x => x.trim() === provider);
}
function sign(encoded: string) {
  if (!env.AUTH_SECRET || env.AUTH_SECRET.length < 32)
    throw new Error('External lead signing is not configured');
  return createHmac('sha256', env.AUTH_SECRET)
    .update('jobx-external-lead-v1:' + encoded).digest();
}
export function sealExternalLead(lead: SearchLead, userId: string, now = Date.now()) {
  if (!providerStorageAllowed(lead.provider)) return null;
  const claim = claimSchema.parse({
    userId, expiresAt: now + 15 * 60_000, provider: lead.provider,
    title: lead.title, company: lead.company, location: lead.location, url: lead.url,
  });
  const encoded = Buffer.from(JSON.stringify(claim)).toString('base64url');
  return encoded + '.' + sign(encoded).toString('base64url');
}
export function unsealExternalLead(token: string, userId: string, now = Date.now()): ExternalLeadClaim {
  if (token.length > 5000 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token))
    throw new Error('Invalid external lead token');
  const [encoded, mac] = token.split('.');
  const expected = sign(encoded);
  const supplied = Buffer.from(mac, 'base64url');
  if (expected.length !== supplied.length || !timingSafeEqual(supplied, expected))
    throw new Error('Unauthorized external lead token');
  const claim = claimSchema.parse(JSON.parse(Buffer.from(encoded,'base64url').toString('utf8')));
  if (claim.userId !== userId || claim.expiresAt < now ||
      claim.expiresAt > now + 16 * 60_000 || !providerStorageAllowed(claim.provider))
    throw new Error('External lead token expired or source retention not permitted');
  return claim;
}

import { getDb } from '@/db';
import { developmentEmails } from '@/db/schema';
import { env } from './config';
export async function sendEmail(to: string, subject: string, html: string, idempotencyKey: string) {
  if (env.EMAIL_TRANSPORT === 'development') {
    if (!['development', 'test'].includes(env.APP_ENV))
      throw new Error('Development inbox is forbidden in this environment');
    const [record] = await getDb()
      .insert(developmentEmails)
      .values({ recipient: to, subject, html, dedupeKey: idempotencyKey })
      .onConflictDoUpdate({ target: developmentEmails.dedupeKey, set: { subject } })
      .returning();
    return record.id;
  }
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) throw new Error('Email delivery is not configured');
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify({ from: env.EMAIL_FROM, to: [to], subject, html }),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`Email provider returned ${response.status}`);
  return ((await response.json()) as { id: string }).id;
}

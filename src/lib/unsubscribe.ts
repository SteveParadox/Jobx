import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from './config';
export function alertToken(id: string) {
  if (!env.AUTH_SECRET) throw new Error('AUTH_SECRET is missing');
  return (
    id +
    '.' +
    createHmac('sha256', env.AUTH_SECRET)
      .update('unsubscribe:' + id)
      .digest('base64url')
  );
}

/** Recognize canonical signed tokens without leaking partial HMAC matches through string comparison. */
export function verifyAlertToken(token: string): boolean {
  const match = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\\.([A-Za-z0-9_-]{43})$/.exec(token);
  if (!match) return false;
  const expected = Buffer.from(alertToken(match[1]));
  const supplied = Buffer.from(token);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

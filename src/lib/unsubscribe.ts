import { createHmac } from 'node:crypto';
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

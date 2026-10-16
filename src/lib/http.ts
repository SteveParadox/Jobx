import Redis from 'ioredis';
import { z, ZodError } from 'zod';
import { brand, env, isProduction } from './config';
import { AppError } from './errors';
import { log } from './log';
import { digest } from './security';
let redis: Redis | undefined;
export function getRedis() {
  if (!env.REDIS_URL) throw new AppError(503, 'Redis is not configured');
  return (redis ??= new Redis(env.REDIS_URL, { maxRetriesPerRequest: 1, connectTimeout: 3000 }));
}
export function sameOrigin(req: Request) {
  if (req.headers.get('origin') !== brand.url) throw new AppError(403, 'Invalid request origin');
}
export async function rateLimit(key: string, limit = 30, window = 60) {
  if (!env.REDIS_URL) {
    if (isProduction) throw new AppError(503, 'Rate limiting is unavailable');
    return;
  }
  const redis = getRedis();
  const result = (await redis.eval(
    "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]) end; return n",
    1,
    'rate:' + digest(key),
    window,
  )) as number;
  if (result > limit) throw new AppError(429, 'Too many requests. Try again shortly.');
}
export async function rawBody(req: Request, maximum = 200000): Promise<string> {
  if (Number(req.headers.get('content-length')) > maximum)
    throw new AppError(413, 'Request is too large');
  const reader = req.body?.getReader();
  if (!reader) return '';
  let size = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maximum) {
      await reader.cancel();
      throw new AppError(413, 'Request is too large');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}
export async function body<T extends z.ZodType>(req: Request, schema: T): Promise<z.infer<T>> {
  const text = await rawBody(req);
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new AppError(400, 'Invalid JSON');
  }
  return schema.parse(data);
}
export async function endpoint(fn: () => Promise<unknown>) {
  try {
    const result = await fn();
    if (result instanceof Response) return result;
    return Response.json(result ?? { ok: true }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof AppError)
      return Response.json({ error: error.message }, { status: error.status });
    if (error instanceof ZodError)
      return Response.json(
        { error: 'Please check the submitted fields', issues: error.flatten() },
        { status: 400 },
      );
    log('request_failed', { error: error instanceof Error ? error.name : 'unknown' });
    return Response.json(
      { error: 'The request could not be completed. Please try again.' },
      { status: 500 },
    );
  }
}

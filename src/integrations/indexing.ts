import { getDb } from '@/db';
import { indexingNotifications, jobs } from '@/db/schema';
import { getPublicJob } from '@/domain/search';
import { eligible, jobPath } from '@/domain/seo';
import { brand, env, isProduction } from '@/lib/config';
import { getRedis } from '@/lib/http';
import { eq, sql } from 'drizzle-orm';
import { importPKCS8, SignJWT } from 'jose';
let cached: { token: string; expires: number } | undefined;
async function accessToken() {
  if (cached && cached.expires > Date.now()) return cached.token;
  if (!env.GOOGLE_CLIENT_EMAIL || !env.GOOGLE_PRIVATE_KEY)
    throw new Error('Google Indexing credentials are missing');
  const key = await importPKCS8(env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'), 'RS256');
  const assertion = await new SignJWT({ scope: 'https://www.googleapis.com/auth/indexing' })
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuer(env.GOOGLE_CLIENT_EMAIL)
    .setAudience('https://oauth2.googleapis.com/token')
    .setIssuedAt()
    .setExpirationTime('55m')
    .sign(key);
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`Google auth ${response.status}`);
  const result = await response.json();
  cached = { token: result.access_token, expires: Date.now() + 3000000 };
  return cached.token;
}
export async function submitIndexing(id: string) {
  if (!isProduction || !env.GOOGLE_INDEXING_ENABLED) return;
  const db = getDb();
  const [item] = await db
    .select()
    .from(indexingNotifications)
    .where(eq(indexingNotifications.id, id));
  if (!item || item.status === 'submitted' || item.status === 'superseded') return;
  const [job] = await db.select().from(jobs).where(eq(jobs.id, item.jobId));
  if (!job || job.isDemo) return;
  if (job.version !== item.version) {
    await db
      .update(indexingNotifications)
      .set({ status: 'superseded' })
      .where(eq(indexingNotifications.id, id));
    return;
  }
  const publicJob = await getPublicJob(job.id);
  if (item.type === 'URL_UPDATED' && (!publicJob || !eligible(publicJob))) {
    await db
      .update(indexingNotifications)
      .set({
        status: 'ineligible',
        result: 'Missing required validated fields or job is unavailable',
      })
      .where(eq(indexingNotifications.id, id));
    return;
  }
  const quotaKey = 'indexing-quota:' + new Date().toISOString().slice(0, 10);
  const permitted = await getRedis().eval(
    "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],172800) end; if n>tonumber(ARGV[1]) then redis.call('DECR',KEYS[1]); return 0 end; return 1",
    1,
    quotaKey,
    env.GOOGLE_INDEXING_DAILY_LIMIT,
  );
  if (permitted !== 1) throw new Error('Configured daily Indexing API quota reached');
  await db
    .update(indexingNotifications)
    .set({ attempts: sql`${indexingNotifications.attempts}+1` })
    .where(eq(indexingNotifications.id, id));
  const response = await fetch('https://indexing.googleapis.com/v3/urlNotifications:publish', {
    method: 'POST',
    headers: { Authorization: `Bearer ${await accessToken()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: brand.url + jobPath(job), type: item.type }),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    await db
      .update(indexingNotifications)
      .set({ status: 'pending', result: `HTTP ${response.status}` })
      .where(eq(indexingNotifications.id, id));
    throw new Error(`Indexing API ${response.status}`);
  }
  await db
    .update(indexingNotifications)
    .set({ status: 'submitted', result: 'Notification accepted; indexing is not guaranteed' })
    .where(eq(indexingNotifications.id, id));
}

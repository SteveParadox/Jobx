import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { eq } from 'drizzle-orm';
import { spawn } from 'node:child_process';
import { closeDb, getDb } from '../src/db';
import { auditLogs, resumes } from '../src/db/schema';
import { env } from '../src/lib/config';
import { digest } from '../src/lib/security';
if (!env.S3_BUCKET || !env.S3_ACCESS_KEY_ID || !env.S3_SECRET_ACCESS_KEY)
  throw new Error('Private storage credentials are required');
const client = new S3Client({
  endpoint: env.S3_ENDPOINT || undefined,
  region: env.S3_REGION,
  forcePathStyle: Boolean(env.S3_ENDPOINT),
  credentials: { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY },
});
const pending = await getDb()
  .select()
  .from(resumes)
  .where(eq(resumes.status, 'quarantined'))
  .limit(20);
for (const resume of pending) {
  const object = await client.send(
    new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: resume.objectKey }),
  );
  if ((object.ContentLength ?? 0) > 5 * 1024 * 1024)
    throw new Error('Stored file exceeds the accepted size');
  const bytes = Buffer.from(await object.Body!.transformToByteArray());
  if (digest(bytes) !== resume.sha256)
    throw new Error('Stored object hash differs from quarantine record');
  const result = await new Promise<number>((resolve, reject) => {
    const child = spawn('clamscan', ['--no-summary', '-'], { stdio: ['pipe', 'ignore', 'pipe'] });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('Malware scan timed out'));
    }, 60000);
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      if (code === 0 || code === 1) resolve(code);
      else reject(new Error('Scanner failed; document remains quarantined'));
    });
    child.stdin.on('error', () => {});
    child.stdin.end(bytes);
  });
  await getDb().transaction(async (tx) => {
    await tx
      .update(resumes)
      .set({ status: result === 0 ? 'clean' : 'rejected' })
      .where(eq(resumes.id, resume.id));
    await tx.insert(auditLogs).values({
      action: 'resume.scanned',
      entityId: resume.id,
      detail: {
        sha256: resume.sha256,
        scanner: 'clamscan',
        result: result === 0 ? 'clean' : 'malware',
      },
    });
  });
  console.log(resume.id + ': ' + (result === 0 ? 'clean' : 'rejected'));
}
await closeDb();

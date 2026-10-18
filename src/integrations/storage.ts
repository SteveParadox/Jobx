import { getDb } from '@/db';
import * as s from '@/db/schema';
import { type Actor, employerAccess } from '@/lib/auth';
import type { Tx } from '@/domain/jobs';
import { env } from '@/lib/config';
import { AppError, requireValue } from '@/lib/errors';
import { digest } from '@/lib/security';
import { log } from '@/lib/log';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { and, eq } from 'drizzle-orm';
let client: S3Client | undefined;
function storage() {
  if (!env.S3_BUCKET || !env.S3_ACCESS_KEY_ID || !env.S3_SECRET_ACCESS_KEY)
    throw new AppError(503, 'Private document storage is not configured');
  return (client ??= new S3Client({
    endpoint: env.S3_ENDPOINT || undefined,
    region: env.S3_REGION,
    forcePathStyle: Boolean(env.S3_ENDPOINT),
    credentials: { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY },
  }));
}
export const MAX_RESUME_BYTES = 5 * 1024 * 1024;
export function validateResume(bytes: Buffer, mime: string) {
  if (bytes.length > MAX_RESUME_BYTES || bytes.length < 8)
    throw new AppError(400, 'The document must be between 8 bytes and 5 MB');
  if (mime !== 'application/pdf' || bytes.subarray(0, 5).toString() !== '%PDF-')
    throw new AppError(400, 'Only PDF documents with valid headers are accepted');
}
export async function uploadResume(actor: Actor, bytes: Buffer, filename: string, mime: string) {
  validateResume(bytes, mime);
  const objectKey = `resumes/${actor.id}/${crypto.randomUUID()}.pdf`;
  await storage().send(
    new PutObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: objectKey,
      Body: bytes,
      ContentType: 'application/pdf',
      ContentDisposition: 'attachment',
    }),
  );
  let cleanupQueued = false;
  try {
    const created = await getDb().transaction(async (tx) => {
      // Serialize the final upload decision with account erasure. Uploads
      // finishing after account deletion must not leave a new résumé row.
      const [user] = await tx
        .select({ disabled: s.user.disabled })
        .from(s.user)
        .where(eq(s.user.id, actor.id))
        .for('update');
      if (!user || user.disabled) {
        await tx.insert(s.outbox).values({
          topic: 'storage-delete',
          payload: { objectKey },
          dedupeKey: 'storage-delete-orphan:' + digest(objectKey),
        }).onConflictDoNothing();
        return null;
      }
      return (
        await tx
          .insert(s.resumes)
          .values({
            userId: actor.id,
            objectKey,
            filename: filename.replace(/[^a-zA-Z0-9 ._-]/g, '').slice(0, 100) || 'resume.pdf',
            mime,
            bytes: bytes.length,
            sha256: digest(bytes),
            status: 'quarantined',
          })
          .returning({ id: s.resumes.id, status: s.resumes.status })
      )[0];
    });
    if (!created) {
      cleanupQueued = true;
      throw new AppError(409, 'The account is no longer active; the uploaded document is queued for deletion');
    }
    return created;
  } catch (error) {
    if (!cleanupQueued) {
      try {
        await storage().send(new DeleteObjectCommand({ Bucket: env.S3_BUCKET, Key: objectKey }));
      } catch {
        // Attempt a durable fallback if immediate compensation is unavailable.
        try {
          await getDb().insert(s.outbox).values({
            topic: 'storage-delete',
            payload: { objectKey },
            dedupeKey: 'storage-delete-orphan:' + digest(objectKey),
          }).onConflictDoNothing();
        } catch {
          log('resume_orphan_cleanup_unavailable', { objectKeyDigest: digest(objectKey) });
        }
      }
    }
    throw error;
  }
}
export async function resumeAccess(actor: Actor, id: string) {
  const resume = requireValue(
    (await getDb().select().from(s.resumes).where(eq(s.resumes.id, id)))[0],
  );
  if (resume.userId !== actor.id) {
    if (resume.status !== 'clean') throw new AppError(403, 'This document is quarantined');
    const apps = await getDb()
      .select({ employerId: s.jobs.employerId })
      .from(s.applications)
      .innerJoin(s.jobs, eq(s.applications.jobId, s.jobs.id))
      .where(eq(s.applications.resumeId, id));
    let authorized = false;
    for (const app of apps) {
      try {
        await employerAccess(actor, app.employerId);
        authorized = true;
        break;
      } catch {}
    }
    if (!authorized) throw new AppError(403, 'Document access denied');
  }
  if (resume.status !== 'clean')
    throw new AppError(409, 'This document is awaiting security review');
  await getDb()
    .insert(s.auditLogs)
    .values({ actorId: actor.id, action: 'resume.downloaded', entityId: id });
  return getSignedUrl(
    storage(),
    new GetObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: resume.objectKey,
      ResponseContentDisposition: 'attachment; filename="resume.pdf"',
    }),
    { expiresIn: 60 },
  );
}
/** Record a durable deletion command inside the same transaction that removes metadata.
 * The worker repeats object deletion safely after crashes and transient S3 failures.
 */
export async function queueResumeCleanup(tx: Tx, documents: { id: string; objectKey: string }[]) {
  for (const document of documents) {
    await tx.insert(s.outbox).values({
      topic: 'storage-delete',
      payload: { objectKey: document.objectKey },
      dedupeKey: 'storage-delete:' + document.id,
    }).onConflictDoNothing();
  }
}
export async function deleteStoredResume(objectKey: string) {
  if (!/^resumes\/[a-zA-Z0-9_-]+\/[0-9a-f-]{36}\.pdf$/.test(objectKey))
    throw new Error('Unexpected résumé object key');
  await storage().send(new DeleteObjectCommand({ Bucket: env.S3_BUCKET, Key: objectKey }));
}
export async function removeResume(actor: Actor, id: string) {
  await getDb().transaction(async (tx) => {
    const resume = requireValue(
      (await tx.select().from(s.resumes)
        .where(and(eq(s.resumes.id, id), eq(s.resumes.userId, actor.id)))
        .for('update'))[0],
    );
    await queueResumeCleanup(tx, [resume]);
    await tx.delete(s.resumes)
      .where(and(eq(s.resumes.id, id), eq(s.resumes.userId, actor.id)));
  });
}

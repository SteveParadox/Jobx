import { getDb } from '@/db';
import * as s from '@/db/schema';
import { type Actor, employerAccess } from '@/lib/auth';
import { env } from '@/lib/config';
import { AppError, requireValue } from '@/lib/errors';
import { digest } from '@/lib/security';
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
  try {
    return (
      await getDb()
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
  } catch (error) {
    await storage().send(new DeleteObjectCommand({ Bucket: env.S3_BUCKET, Key: objectKey }));
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
export async function removeResume(actor: Actor, id: string) {
  const resume = requireValue(
    (
      await getDb()
        .select()
        .from(s.resumes)
        .where(and(eq(s.resumes.id, id), eq(s.resumes.userId, actor.id)))
    )[0],
  );
  await storage().send(new DeleteObjectCommand({ Bucket: env.S3_BUCKET, Key: resume.objectKey }));
  await getDb().delete(s.resumes).where(eq(s.resumes.id, id));
}
export async function removeUserObjects(actor: Actor) {
  const rows = await getDb().select().from(s.resumes).where(eq(s.resumes.userId, actor.id));
  for (const row of rows)
    await storage().send(new DeleteObjectCommand({ Bucket: env.S3_BUCKET, Key: row.objectKey }));
}

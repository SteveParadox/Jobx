import { MAX_RESUME_BYTES, uploadResume } from '@/integrations/storage';
import { requireActor } from '@/lib/auth';
import { AppError } from '@/lib/errors';
import { endpoint, rateLimit, sameOrigin } from '@/lib/http';
export async function POST(req: Request) {
  return endpoint(async () => {
    sameOrigin(req);
    const actor = await requireActor(req);
    await rateLimit('upload:' + actor.id, 5, 3600);
    if (Number(req.headers.get('content-length')) > MAX_RESUME_BYTES)
      throw new AppError(413, 'Résumé is too large');
    const reader = req.body?.getReader();
    if (!reader) throw new AppError(400, 'No document supplied');
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > MAX_RESUME_BYTES) {
        await reader.cancel();
        throw new AppError(413, 'Résumé is too large');
      }
      chunks.push(value);
    }
    return uploadResume(
      actor,
      Buffer.concat(chunks),
      req.headers.get('x-file-name') ?? 'resume.pdf',
      req.headers.get('content-type') ?? '',
    );
  });
}

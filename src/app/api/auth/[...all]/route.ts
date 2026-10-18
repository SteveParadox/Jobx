import { getAuth } from '@/lib/auth';
import { env } from '@/lib/config';
import { clientAddress, endpoint, rateLimit, sameOrigin } from '@/lib/http';
async function handler(req: Request) {
  return endpoint(async () => {
    if (req.method === 'POST') sameOrigin(req);
    const ip = clientAddress(req);
    // E2E/test environments may share a conservative unverified client bucket.
    // Production keeps the stricter ingress-level cap.
    await rateLimit('auth:' + ip, env.APP_ENV === 'test' ? 200 : 20, 60);
    return getAuth().handler(req);
  });
}
export const GET = handler;
export const POST = handler;

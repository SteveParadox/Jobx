import { getAuth } from '@/lib/auth';
import { endpoint, rateLimit, sameOrigin } from '@/lib/http';
async function handler(req: Request) {
  return endpoint(async () => {
    if (req.method === 'POST') sameOrigin(req);
    const ip =
      req.headers.get('x-vercel-forwarded-for') ?? req.headers.get('x-forwarded-for') ?? 'unknown';
    await rateLimit('auth:' + ip, 20, 60);
    return getAuth().handler(req);
  });
}
export const GET = handler;
export const POST = handler;

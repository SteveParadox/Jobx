import { getAuth } from '@/lib/auth';
import { clientAddress, endpoint, rateLimit, sameOrigin } from '@/lib/http';
async function handler(req: Request) {
  return endpoint(async () => {
    if (req.method === 'POST') sameOrigin(req);
    const ip = clientAddress(req);
    await rateLimit('auth:' + ip, 20, 60);
    return getAuth().handler(req);
  });
}
export const GET = handler;
export const POST = handler;

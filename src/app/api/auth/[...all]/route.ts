import { getAuth } from '@/lib/auth';
import { env } from '@/lib/config';
import { authClientRequest, clientAddress, endpoint, rateLimit, sameOrigin } from '@/lib/http';

async function handler(req: Request) {
  let stage = 'origin';
  return endpoint(
    async () => {
      if (req.method === 'POST') sameOrigin(req);
      stage = 'rate-limit';
      const ip = clientAddress(req);
      // E2E/test environments may share a conservative unverified client bucket.
      // Production keeps the stricter ingress-level cap.
      await rateLimit('auth:' + ip, env.APP_ENV === 'test' ? 200 : 20, 60);
      stage = 'auth-initialization';
      const auth = getAuth();
      stage = 'request-clone';
      const preparedRequest = authClientRequest(req);
      stage = 'better-auth-handler';
      return auth.handler(preparedRequest);
    },
    (error) => {
      // The shared API handler deliberately hides exception details from callers.
      // Keep enough information in *local development* to identify auth failures
      // without logging request bodies, cookies, bearer tokens or user emails.
      if (env.APP_ENV !== 'development') return;
      const failure = error instanceof Error ? error : undefined;
      const frames = failure?.stack?.split('\n').slice(1, 7).map((line) => line.trim());
      console.error('[auth-debug]', {
        stage,
        type: failure?.name ?? 'unknown',
        ...(failure instanceof TypeError ? { message: failure.message.slice(0, 240) } : {}),
        frames,
      });
    },
  );
}
export const GET = handler;
export const POST = handler;

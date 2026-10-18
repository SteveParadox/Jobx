import { getDb } from '@/db';
import * as schema from '@/db/schema';
import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { betterAuth } from 'better-auth';
import { and, eq } from 'drizzle-orm';
import { headers } from 'next/headers';
import { assertRuntime, brand, env, isProduction } from './config';
import { sendEmail } from './email';
import { AppError } from './errors';
import { digest, escapeHtml } from './security';
import { getRedis } from './http';
let instance: ReturnType<typeof createAuth> | undefined;
function createAuth() {
  assertRuntime();
  return betterAuth({
    appName: brand.name,
    baseURL: brand.url,
    secret: env.AUTH_SECRET,
    database: drizzleAdapter(getDb(), {
      provider: 'pg',
      schema: {
        user: schema.user,
        session: schema.session,
        account: schema.account,
        verification: schema.verification,
      },
    }),
    trustedOrigins: [brand.url],
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 12,
      requireEmailVerification: true,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => {
        await sendEmail(
          user.email,
          'Reset your password',
          `<p><a href="${escapeHtml(url)}">Reset password</a></p>`,
          digest(url),
        );
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: true,
      autoSignInAfterVerification: false,
      sendVerificationEmail: async ({ user, url }) => {
        await sendEmail(
          user.email,
          'Verify your email',
          `<p><a href="${escapeHtml(url)}">Verify email</a></p>`,
          digest(url),
        );
      },
    },
    socialProviders:
      env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
        ? { google: { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET } }
        : {},
    user: { deleteUser: { enabled: false } },
    session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24 },
    advanced: {
      useSecureCookies: isProduction,
      ipAddress: { ipAddressHeaders: [
        process.env.VERCEL === '1' ? 'x-vercel-forwarded-for' :
          (process.env.TRUSTED_PROXY_IP_HEADER || 'x-real-ip'),
      ] },
    },
    rateLimit: {
      enabled: true,
      window: 60,
      max: 60,
      ...(env.APP_ENV === 'test' || !env.REDIS_URL
        ? { storage: 'memory' as const }
        : {
            customStorage: {
              consume: async (key: string, rule: { window: number; max: number }) => {
                const redis = getRedis();
                const bucket = 'auth-rate:' + digest(key);
                const count = Number(await redis.eval(
                  "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]) end; return n",
                  1, bucket, rule.window,
                ));
                return { allowed: count <= rule.max, retryAfter: count > rule.max ? rule.window : null };
              },
            },
          }),
    },
  });
}
export function getAuth() {
  return (instance ??= createAuth());
}

export type Actor = {
  id: string;
  email: string;
  name: string;
  role: string;
  emailVerified: boolean;
  disabled: boolean;
};
export async function currentActor(request?: Request): Promise<Actor | null> {
  if (!env.DATABASE_URL) return null;
  const data = await getAuth().api.getSession({ headers: request?.headers ?? (await headers()) });
  if (!data) return null;
  const actor = (
    await getDb().select().from(schema.user).where(eq(schema.user.id, data.user.id)).limit(1)
  )[0];
  if (!actor || actor.disabled || (isProduction && actor.id.startsWith('demo-'))) return null;
  return actor;
}
export async function requireActor(request?: Request) {
  const actor = await currentActor(request);
  if (!actor) throw new AppError(401, 'Please sign in');
  if (!actor.emailVerified) throw new AppError(403, 'Verify your email first');
  return actor;
}
export function admin(actor: Actor) {
  if (actor.role !== 'admin' || actor.disabled)
    throw new AppError(403, 'Administrator access required');
}
export async function employerAccess(
  actor: Actor,
  employerId: string,
  roles = ['owner', 'admin', 'recruiter'],
) {
  const [membership] = await getDb()
    .select({ role: schema.memberships.role, disabled: schema.employers.disabled })
    .from(schema.memberships)
    .innerJoin(schema.employers, eq(schema.memberships.employerId, schema.employers.id))
    .where(
      and(eq(schema.memberships.userId, actor.id), eq(schema.memberships.employerId, employerId)),
    )
    .limit(1);
  if (!membership || membership.disabled || !roles.includes(membership.role))
    throw new AppError(403, 'You do not have permission for this organization');
  return membership;
}

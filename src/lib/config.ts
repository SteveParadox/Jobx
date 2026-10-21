import { z } from 'zod';
const optional = z.string().optional();
const bool = z
  .string()
  .optional()
  .transform((v) => v === 'true');
const schema = z.object({
  APP_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  SITE_NAME: z.string().min(1).default('CareerAtlas'),
  SITE_URL: z.url().default('http://localhost:3000'),
  BRAND_COLOR: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .default('#123d32'),
  SUPPORT_EMAIL: optional,
  DATABASE_URL: optional,
  DATABASE_SSL: bool,
  REDIS_URL: optional,
  AUTH_SECRET: optional,
  GOOGLE_CLIENT_ID: optional,
  GOOGLE_CLIENT_SECRET: optional,
  RESEND_API_KEY: optional,
  EMAIL_TRANSPORT: z.enum(['resend', 'development']).default('resend'),
  EMAIL_FROM: optional,
  DEMO_MODE: bool,
  STRIPE_SECRET_KEY: optional,
  STRIPE_WEBHOOK_SECRET: optional,
  PAYSTACK_SECRET_KEY: optional,
  S3_ENDPOINT: optional,
  S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET: optional,
  S3_ACCESS_KEY_ID: optional,
  S3_SECRET_ACCESS_KEY: optional,
  GOOGLE_INDEXING_ENABLED: bool,
  GOOGLE_INDEXING_DAILY_LIMIT: z.coerce.number().int().min(1).max(10000).default(100),
  GOOGLE_CLIENT_EMAIL: optional,
  GOOGLE_PRIVATE_KEY: optional,
  ANALYTICS_ENABLED: bool,
  SOURCE_BROWSER_ENABLED: bool,
  JOB_DISCOVERY_ENABLED: bool,
  JOB_DISCOVERY_SEEDS: optional,
  JOB_DISCOVERY_INTERVAL_MINUTES: z.coerce.number().int().min(15).max(10080).default(60),
});
export const env = schema.parse(process.env);
export const isProduction = env.APP_ENV === 'production';
export function assertRuntime() {
  if (process.env.VERCEL_ENV === 'production' && env.APP_ENV !== 'production')
    throw new Error('A production Vercel deployment must use APP_ENV=production');
  if (process.env.VERCEL_ENV === 'preview' && env.APP_ENV === 'production')
    throw new Error('A preview deployment must not be treated as public production');
  if (env.APP_ENV === 'production' && process.env.VERCEL !== '1' && !process.env.TRUSTED_PROXY_IP_HEADER)
    throw new Error('Production self-hosting requires a trusted ingress IP header configuration');
  if (process.env.TRUSTED_PROXY_IP_HEADER &&
      !['x-real-ip', 'cf-connecting-ip'].includes(process.env.TRUSTED_PROXY_IP_HEADER))
    throw new Error('TRUSTED_PROXY_IP_HEADER must name a supported sanitized ingress header');
  if (env.EMAIL_TRANSPORT === 'development' && !['development', 'test'].includes(env.APP_ENV))
    throw new Error('Development email transport is forbidden outside development/test');
  if (env.GOOGLE_INDEXING_ENABLED && (!env.GOOGLE_CLIENT_EMAIL || !env.GOOGLE_PRIVATE_KEY))
    throw new Error('Enabled Google Indexing requires service account credentials');
  for (const key of ['DATABASE_URL', 'REDIS_URL', 'AUTH_SECRET'] as const)
    if (!env[key]) throw new Error(`Missing ${key}`);
  if ((env.AUTH_SECRET?.length ?? 0) < 32)
    throw new Error('AUTH_SECRET must be at least 32 characters');
  if (isProduction && /replace-with|ci-only|test-secret|change-me/i.test(env.AUTH_SECRET ?? ''))
    throw new Error('Replace the example AUTH_SECRET before production');
  if (
    isProduction &&
    (env.DEMO_MODE ||
      !env.SITE_URL.startsWith('https://') ||
      !env.RESEND_API_KEY ||
      !env.EMAIL_FROM ||
      env.EMAIL_TRANSPORT !== 'resend')
  )
    throw new Error('Production requires HTTPS, verified email delivery and DEMO_MODE=false');
}
export const brand = {
  name: env.SITE_NAME,
  url: env.SITE_URL.replace(/\/$/, ''),
  color: env.BRAND_COLOR,
};

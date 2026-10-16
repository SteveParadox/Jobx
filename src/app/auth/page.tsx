import { AuthForm } from '@/components/auth-form';
import { metadata } from '@/domain/seo';
import { env } from '@/lib/config';
import { Suspense } from 'react';
export const dynamic = 'force-dynamic';
export const generateMetadata = () =>
  metadata(
    'Account access',
    'Sign in, register, verify your email or recover your account.',
    '/auth',
    false,
  );
export default function Auth() {
  return (
    <Suspense fallback={<p className="container">Loading account access…</p>}>
      <AuthForm googleEnabled={Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET)} />
    </Suspense>
  );
}

'use client';
import { authClient } from '@/lib/auth-client';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { Button, Notice } from './ui';
export function AuthForm({ googleEnabled = false }: { googleEnabled?: boolean }) {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get('token') ?? undefined;
  const [mode, setMode] = useState<'login' | 'register' | 'forgot' | 'reset'>(
    token ? 'reset' : 'login',
  );
  const [message, setMessage] = useState(
    params.get('error') ? 'The link is invalid or expired. Request a new one.' : '',
  );
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <div className="auth-card">
      <div className="eyebrow">YOUR CAREER WORKSPACE</div>
      <h1>
        {mode === 'reset'
          ? 'Choose a new password'
          : mode === 'forgot'
            ? 'Reset your password'
            : 'A little closer to what’s next.'}
      </h1>
      <p>One account for your search, applications and employer teams.</p>
      {!['forgot', 'reset'].includes(mode) && (
        <div className="auth-tabs" role="tablist" aria-label="Account access">
          <button role="tab" aria-selected={mode === 'login'} onClick={() => setMode('login')}>
            Sign in
          </button>
          <button
            role="tab"
            aria-selected={mode === 'register'}
            onClick={() => setMode('register')}
          >
            Create account
          </button>
        </div>
      )}
      <form
        className="stack"
        onSubmit={async (e) => {
          e.preventDefault();
          const d = new FormData(e.currentTarget);
          setBusy(true);
          setMessage('');
          setError(false);
          try {
            const email = String(d.get('email') ?? '');
            const password = String(d.get('password') ?? '');
            if (mode === 'register') {
              const r = await authClient.signUp.email({
                email,
                password,
                name: String(d.get('name')),
                callbackURL: '/auth',
              });
              if (r.error) throw new Error(r.error.message);
              setMessage('Check your email to verify your account, then sign in.');
            } else if (mode === 'login') {
              const r = await authClient.signIn.email({
                email,
                password,
                callbackURL: '/dashboard',
              });
              if (r.error) throw new Error(r.error.message);
              router.push('/dashboard');
            } else if (mode === 'forgot') {
              const r = await authClient.requestPasswordReset({ email, redirectTo: '/auth' });
              if (r.error) throw new Error(r.error.message);
              setMessage('If an account exists, a reset link will be sent to that address.');
            } else {
              const r = await authClient.resetPassword({ newPassword: password, token });
              if (r.error) throw new Error(r.error.message);
              setMode('login');
              setMessage('Password reset. Sign in with your new password.');
            }
          } catch (e) {
            setError(true);
            setMessage((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {mode === 'register' && (
          <label>
            Full name
            <input name="name" required maxLength={150} autoComplete="name" />
          </label>
        )}
        {mode !== 'reset' && (
          <label>
            Email address
            <input type="email" name="email" required autoComplete="email" />
          </label>
        )}
        {mode !== 'forgot' && (
          <label>
            Password
            <input
              aria-label="Password"
              type="password"
              name="password"
              required
              minLength={12}
              maxLength={128}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            />
            <small>Use at least 12 characters.</small>
          </label>
        )}
        {mode === 'register' && (
          <label className="checkbox">
            <input type="checkbox" required />I accept the <Link href="/terms">Terms</Link> and have
            read the <Link href="/privacy">Privacy notice</Link>.
          </label>
        )}
        <Button disabled={busy}>
          {busy
            ? 'Please wait…'
            : mode === 'login'
              ? 'Sign in'
              : mode === 'register'
                ? 'Create account'
                : mode === 'reset'
                  ? 'Set new password'
                  : 'Send reset link'}
        </Button>
      </form>
      {message && (
        <div style={{ marginTop: 18 }}>
          <Notice error={error}>{message}</Notice>
        </div>
      )}
      {mode === 'login' && (
        <button
          className="text-button"
          onClick={() => {
            setMode('forgot');
            setMessage('');
          }}
        >
          Forgot password?
        </button>
      )}
      {(mode === 'forgot' || mode === 'reset') && (
        <button
          className="text-button"
          onClick={() => {
            setMode('login');
            setMessage('');
          }}
        >
          Back to sign in
        </button>
      )}
      {googleEnabled && mode === 'login' && (
        <Button
          variant="secondary"
          style={{ width: '100%', marginTop: 15 }}
          onClick={async () => {
            const r = await authClient.signIn.social({
              provider: 'google',
              callbackURL: '/dashboard',
            });
            if (r.error) {
              setError(true);
              setMessage(r.error.message ?? 'Google sign in failed');
            }
          }}
        >
          Continue with Google
        </Button>
      )}
    </div>
  );
}

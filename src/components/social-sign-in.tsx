'use client';

import { authClient } from '@/lib/auth-client';
import { LoaderCircle } from 'lucide-react';
import { useState } from 'react';
import styles from './social-sign-in.module.css';

type SocialProvider = 'google' | 'github';

type SocialSignInProps = {
  googleEnabled: boolean;
  githubEnabled: boolean;
  callbackURL: '/dashboard' | '/employers';
  errorCallbackURL: '/auth' | '/auth?next=%2Femployers';
  allowSignUp?: boolean;
  termsAccepted?: boolean;
};

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M21.6 12.23c0-.68-.06-1.33-.18-1.95H12v3.89h5.38a4.59 4.59 0 0 1-1.99 3.01v2.5h3.22c1.88-1.74 2.99-4.3 2.99-7.45Z"
      />
      <path
        fill="#34A853"
        d="M12 22c2.7 0 4.97-.89 6.61-2.32l-3.22-2.5c-.89.59-2.03.95-3.39.95a6 6 0 0 1-5.64-4.15H3.04v2.58A10 10 0 0 0 12 22Z"
      />
      <path
        fill="#FBBC05"
        d="M6.36 13.98a6.02 6.02 0 0 1 0-3.96V7.44H3.04a10 10 0 0 0 0 9.12l3.32-2.58Z"
      />
      <path
        fill="#EA4335"
        d="M12 5.87c1.47 0 2.79.5 3.83 1.51L18.71 4.5A9.58 9.58 0 0 0 12 2a10 10 0 0 0-8.96 5.44l3.32 2.58A6 6 0 0 1 12 5.87Z"
      />
    </svg>
  );
}

function GitHubMark() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M12 0C5.37 0 0 5.373 0 12c0 5.303 3.438 9.8 8.205 11.385.6.112.82-.26.82-.577 0-.285-.01-1.04-.015-2.04-3.338.725-4.043-1.61-4.043-1.61-.546-1.387-1.333-1.757-1.333-1.757-1.09-.745.083-.73.083-.73 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.108-.775.418-1.305.762-1.605-2.665-.303-5.467-1.333-5.467-5.931 0-1.311.469-2.381 1.237-3.221-.124-.303-.536-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.535 11.535 0 0 1 12 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.655 1.652.243 2.873.12 3.176.77.84 1.235 1.91 1.235 3.221 0 4.61-2.807 5.624-5.48 5.921.43.372.823 1.102.823 2.222 0 1.605-.014 2.898-.014 3.293 0 .32.216.694.825.576C20.565 21.796 24 17.299 24 12c0-6.627-5.373-12-12-12z" />
    </svg>
  );
}

export function SocialSignIn({
  googleEnabled,
  githubEnabled,
  callbackURL,
  errorCallbackURL,
  allowSignUp = false,
  termsAccepted = false,
}: SocialSignInProps) {
  const [pending, setPending] = useState<SocialProvider | null>(null);
  const [error, setError] = useState('');

  if (!googleEnabled && !githubEnabled) return null;

  async function signIn(provider: SocialProvider) {
    if (pending) return;
    if (allowSignUp && !termsAccepted) {
      setError(
        'Please accept the Terms and read the Privacy notice before creating an account.',
      );
      return;
    }
    setPending(provider);
    setError('');
    try {
      const result = await authClient.signIn.social({
        provider,
        callbackURL,
        errorCallbackURL,
        requestSignUp: allowSignUp,
      });
      if (result.error) throw new Error(result.error.message || 'Unable to start sign-in.');
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Unable to start sign-in. Please try again.',
      );
    } finally {
      setPending(null);
    }
  }

  return (
    <div className={styles.section} data-testid="social-auth">
      <div className={styles.divider}>
        <span>or continue with</span>
      </div>
      <div className={styles.options}>
        {googleEnabled && (
          <button
            type="button"
            className={styles.provider}
            disabled={pending !== null}
            onClick={() => void signIn('google')}
            aria-label="Continue with Google"
          >
            {pending === 'google' ? (
              <LoaderCircle className={styles.spinner} size={19} aria-hidden="true" />
            ) : (
              <GoogleMark />
            )}
            <span>Google</span>
          </button>
        )}
        {githubEnabled && (
          <button
            type="button"
            className={styles.provider}
            disabled={pending !== null}
            onClick={() => void signIn('github')}
            aria-label="Continue with GitHub"
          >
            {pending === 'github' ? (
              <LoaderCircle className={styles.spinner} size={19} aria-hidden="true" />
            ) : (
              <GitHubMark />
            )}
            <span>GitHub</span>
          </button>
        )}
      </div>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

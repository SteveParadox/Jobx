'use client';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { api } from './actions';
import { Button, Notice } from './ui';
export function Invitation() {
  const router = useRouter();
  const params = useSearchParams();
  const [message, setMessage] = useState('');
  return (
    <section className="auth-card">
      <h1>Join your employer team.</h1>
      <p>Sign in with the verified email address that received this invitation.</p>
      <Button
        onClick={async () => {
          try {
            await api('invitations/accept', 'POST', { token: params.get('token') });
            router.push('/employers');
          } catch (e) {
            setMessage((e as Error).message);
          }
        }}
      >
        Accept invitation
      </Button>
      {message && (
        <Notice>
          {message} <Link href="/auth">Account access →</Link>
        </Notice>
      )}
    </section>
  );
}
export function Unsubscribe() {
  const params = useSearchParams();
  const token = params.get('token');
  const [message, setMessage] = useState('');
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <section className="auth-card">
      <h1>Keep your inbox on your terms.</h1>
      <p>Disable this alert. This does not delete your account or other alerts.</p>
      <Button
        disabled={busy || !token}
        onClick={async () => {
          if (!token || busy) return;
          setBusy(true);
          setError(false);
          setMessage('');
          try {
            await api('unsubscribe', 'POST', { token });
            setMessage('This alert is disabled. No new digests will be scheduled.');
          } catch (e) {
            setError(true);
            setMessage((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? 'Unsubscribing…' : 'Unsubscribe from this alert'}
      </Button>
      {!token && <Notice error>This unsubscribe link is missing its token.</Notice>}
      {message && <Notice error={error}>{message}</Notice>}
    </section>
  );
}

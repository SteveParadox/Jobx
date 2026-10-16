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
  const [message, setMessage] = useState('');
  return (
    <section className="auth-card">
      <h1>Keep your inbox on your terms.</h1>
      <p>Disable this alert. This does not delete your account or other alerts.</p>
      <Button
        onClick={async () => {
          try {
            await api('unsubscribe', 'POST', { token: params.get('token') });
            setMessage('This alert is disabled. No further digests will be sent.');
          } catch (e) {
            setMessage((e as Error).message);
          }
        }}
      >
        Unsubscribe from this alert
      </Button>
      {message && <Notice>{message}</Notice>}
    </section>
  );
}

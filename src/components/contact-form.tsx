'use client';
import { useState } from 'react';
import { api } from './actions';
import { Button, Notice } from './ui';
export function ContactForm() {
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="stack"
      onSubmit={async (e) => {
        e.preventDefault();
        const d = new FormData(e.currentTarget);
        setBusy(true);
        try {
          await api('contact', 'POST', Object.fromEntries(d));
          setMessage('Your message was received and is available to the support team.');
        } catch (e) {
          setMessage((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <label>
        Your email
        <input type="email" name="email" required />
      </label>
      <label>
        Subject
        <input name="subject" required minLength={3} maxLength={160} />
      </label>
      <label>
        How can we help?
        <textarea name="body" required minLength={20} maxLength={5000} rows={6} />
      </label>
      <Button disabled={busy}>Send message</Button>
      {message && <Notice>{message}</Notice>}
    </form>
  );
}
export function CookiePreferences() {
  const [message, setMessage] = useState('');
  return (
    <section className="stack">
      <p>
        Essential authentication and security cookies are required for account features. Optional
        analytics are off unless you opt in. No advertising cookies are used by this application.
      </p>
      <Button
        variant="secondary"
        onClick={() => {
          localStorage.setItem('careeratlas-consent', 'essential');
          setMessage('Preference saved: essential cookies only.');
        }}
      >
        Use essential cookies only
      </Button>
      <Button
        onClick={() => {
          localStorage.setItem('careeratlas-consent', 'analytics');
          setMessage(
            'Preference saved: optional anonymous product analytics allowed when configured.',
          );
        }}
      >
        Allow optional product analytics
      </Button>
      {message && <Notice>{message}</Notice>}
    </section>
  );
}

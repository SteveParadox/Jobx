'use client';
import { ArrowUpRight, Bell, Bookmark, Flag } from 'lucide-react';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { Button, Field, Notice } from './ui';
export async function api(path: string, method = 'GET', data?: unknown) {
  const response = await fetch('/api/platform/' + path, {
    method,
    headers: data ? { 'Content-Type': 'application/json' } : undefined,
    body: data ? JSON.stringify(data) : undefined,
  });
  const result = await response.json();
  if (!response.ok) {
    const fields = Object.entries(result.issues?.fieldErrors ?? {})
      .map(
        ([field, errors]) =>
          `${field}: ${Array.isArray(errors) ? errors.join(', ') : String(errors)}`,
      )
      .join('; ');
    throw new Error(
      (result.error ?? 'The request could not be completed') + (fields ? '. ' + fields : ''),
    );
  }
  return result;
}
export function SaveJob({ jobId }: { jobId: string }) {
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <>
      <Button
        variant="secondary"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError('');
          try {
            await api('saved-jobs', 'POST', { jobId, save: !saved });
            setSaved(!saved);
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <Bookmark size={17} />
        {saved ? 'Saved to workspace' : 'Save job'}
      </Button>
      {error && (
        <Notice error>
          {error} <Link href="/auth">Sign in</Link>
        </Notice>
      )}
    </>
  );
}
export function ReportJob({ jobId }: { jobId: string }) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  return (
    <div>
      <button className="text-button" onClick={() => setOpen(!open)}>
        <Flag size={14} />
        Report this job
      </button>
      {open && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              const d = new FormData(e.currentTarget);
              await api('report', 'POST', { jobId, reason: d.get('reason') });
              setMessage('Report received. Our team will review it.');
            } catch (e) {
              setMessage((e as Error).message);
            }
          }}
        >
          <label>
            What seems wrong?
            <textarea name="reason" minLength={10} maxLength={2000} required />
          </label>
          <Button variant="secondary">Submit report</Button>
        </form>
      )}
      {message && <Notice>{message}</Notice>}
    </div>
  );
}
export function ExternalApply({ url, jobId }: { url: string; jobId: string }) {
  return (
    <a
      className="button button-primary"
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={() => {
        api('external-activity', 'POST', { jobId, status: 'clicked_external' }).catch(() => {
          /* Opening the employer site does not depend on an account. */
        });
      }}
    >
      Apply on employer site <ArrowUpRight size={18} />
    </a>
  );
}
export function NativeApply({
  jobId,
  resumeRequired = false,
}: {
  jobId: string;
  resumeRequired?: boolean;
}) {
  const [message, setMessage] = useState('');
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    setBusy(true);
    try {
      await api('applications', 'POST', {
        jobId,
        coverLetter: data.get('coverLetter'),
        ...(data.get('resumeId') ? { resumeId: data.get('resumeId') } : {}),
      });
      setOk(true);
      setMessage('Application received. You can track it in your workspace.');
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel" id="apply">
      <h2>Apply for this role</h2>
      <p>
        Sign in with a verified email to submit. Your application is confirmed only after it is
        saved.
      </p>
      {!ok && (
        <form className="stack" onSubmit={submit}>
          <Field label="Cover letter" name="coverLetter">
            <textarea id="coverLetter" name="coverLetter" rows={6} maxLength={10000} />
          </Field>
          <Field
            label={resumeRequired ? 'Résumé identifier (required)' : 'Résumé identifier (optional)'}
            name="resumeId"
            hint="Upload and clear a PDF in your workspace, then copy its identifier."
          >
            <input id="resumeId" name="resumeId" required={resumeRequired} />
          </Field>
          <Button disabled={busy}>{busy ? 'Submitting…' : 'Submit application'}</Button>
        </form>
      )}
      {message && <Notice error={!ok}>{message}</Notice>}
      <Link href="/dashboard">Open your workspace →</Link>
    </section>
  );
}
export function AlertForm({
  filters = {},
  onCreated,
}: {
  filters?: Record<string, unknown>;
  onCreated?: () => Promise<void>;
}) {
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [channel, setChannel] = useState('email');
  const [failed, setFailed] = useState(false);
  return (
    <form
      className="stack"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setFailed(false);
        const d = new FormData(e.currentTarget);
        try {
          await api('alerts', 'POST', {
            name: d.get('name'),
            filters,
            frequency: d.get('frequency'),
            channel,
            consent: true,
          });
          setMessage('Your alert is active. Manage it in your workspace.');
          await onCreated?.();
        } catch (e) {
          setFailed(true);
          setMessage((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <label>
        Alert name
        <input
          name="name"
          required
          minLength={2}
          maxLength={100}
          placeholder="My next opportunity"
        />
      </label>
      <label>
        Frequency
        <select name="frequency">
          <option value="daily">Daily digest</option>
          <option value="weekly">Weekly digest</option>
        </select>
      </label>
      <label>
        Delivery channel
        <select name="channel" value={channel} onChange={(e) => setChannel(e.target.value)}>
          <option value="email">Email and in-app</option>
          <option value="in_app">In-app only</option>
        </select>
      </label>
      <label className="checkbox">
        <input type="checkbox" required key={channel} />I agree to receive matching vacancies
        {channel === 'email' ? ' by email and in my workspace' : ' in my workspace'}. I can pause or
        delete this alert at any time.
      </label>
      <Button disabled={busy}>
        <Bell size={16} />
        Create job alert
      </Button>
      {message && (
        <Notice error={failed}>
          {message} <Link href="/auth">Account access</Link>
        </Notice>
      )}
    </form>
  );
}
export function SaveSearch({ filters }: { filters: Record<string, unknown> }) {
  const [message, setMessage] = useState('');
  return (
    <>
      <button
        className="text-button"
        onClick={async () => {
          try {
            await api('saved-searches', 'POST', {
              name: String(filters.q || 'My search'),
              filters,
            });
            setMessage('Search saved to your workspace.');
          } catch (e) {
            setMessage((e as Error).message);
          }
        }}
      >
        <Bookmark size={15} /> Save this search
      </button>
      {message && <Notice>{message}</Notice>}
    </>
  );
}

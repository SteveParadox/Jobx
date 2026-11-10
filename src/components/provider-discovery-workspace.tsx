'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { api } from './actions';
import { Button, Notice } from './ui';

type Lead = {
  leadKey: string; title: string; company: string; location: string;
  provider: string; url: string; searchQuery: string; state: string;
  firstSeenAt: string; lastSeenAt: string; lastChangedAt: string;
  reviewNote: string | null;
};
type Run = {
  id: string; status: string; queries: number; found: number;
  updated: number; failures: number; startedAt: string;
  error: string | null;
};
type Data = { leads: Lead[]; runs: Run[]; enabled: boolean };

export function ProviderDiscoveryWorkspace() {
  const [data, setData] = useState<Data | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  async function load() {
    try { setData(await api('admin/external-discovery')); setError(''); }
    catch (e) { setError((e as Error).message); }
  }
  useEffect(() => { void Promise.resolve().then(load); }, []);
  async function review(event: FormEvent<HTMLFormElement>, key: string) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true); setMessage(''); setError('');
    try {
      await api('admin/external-discovery/' + key, 'PATCH', {
        state: form.get('state'), note: String(form.get('note') ?? ''),
      });
      setMessage('Review decision recorded. This never approves a source or publishes a job.');
      await load();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  return (
    <div className="stack">
      <section className="panel">
        <h2>Licensed-provider discovery</h2>
        <p>
          Recurring searches are configured by the operator with approved provider keys,
          country markets, storage rights and query seeds. They are disabled by default.
          External leads enter this private review inbox only, never the public jobs catalog.
        </p>
        <div className="row-actions">
          <span className="pill">{data?.enabled ? 'Scheduled' : 'Disabled'}</span>
          <Button type="button" variant="secondary" onClick={() => void load()}>
            Refresh
          </Button>
        </div>
        {error && <Notice error>{error}</Notice>}
        {message && <Notice>{message}</Notice>}
        <h3>Latest runs</h3>
        {!data?.runs.length && <p>No provider discovery runs yet.</p>}
        {data?.runs.map(run => (
          <div className="workspace-row" key={run.id}>
            <div>
              <strong>{run.status} · {new Date(run.startedAt).toLocaleString()}</strong>
              <p>
                Queries {run.queries} · New {run.found} · Changed {run.updated} ·
                Unavailable {run.failures}
              </p>
              {run.error && <p>{run.error}</p>}
            </div>
          </div>
        ))}
      </section>
      <section className="panel">
        <h2>Operator lead review</h2>
        <p>Each lead records its original provider, searched keywords, first-seen date,
          latest observation, and content-change time. A rejected lead stays rejected.
          An edited reviewed lead returns to pending review.</p>
        {!data?.leads.length && <p>No licensed API leads in the inbox.</p>}
        {data?.leads.map(item => (
          <article className="panel" key={item.leadKey}>
            <h3>{item.title}</h3>
            <p>{item.company} · {item.location} · {item.provider} · {item.state}</p>
            <p><a href={item.url} target="_blank" rel="noopener noreferrer">
              Original provider listing
            </a></p>
            <p>Search term: {item.searchQuery}</p>
            <small>
              First: {new Date(item.firstSeenAt).toLocaleString()} ·
              Last seen: {new Date(item.lastSeenAt).toLocaleString()} ·
              Last changed: {new Date(item.lastChangedAt).toLocaleString()}
            </small>
            {item.reviewNote && <p>Prior review: {item.reviewNote}</p>}
            <form className="form-grid" onSubmit={event => void review(event, item.leadKey)}>
              <label>
                Review decision
                <select name="state" defaultValue={item.state === 'rejected' ? 'rejected' : 'reviewed'}>
                  <option value="reviewed">Reviewed; retain as a lead</option>
                  <option value="rejected">Reject this lead</option>
                </select>
              </label>
              <label>
                Review evidence or reason
                <input
                  name="note" required minLength={10} maxLength={2000}
                  defaultValue={item.reviewNote ?? ''}
                />
              </label>
              <Button disabled={busy}>Record review</Button>
            </form>
          </article>
        ))}
      </section>
    </div>
  );
}

'use client';
import { useEffect, useState } from 'react';
import { api } from './actions';
import { Button, Empty, Notice } from './ui';
type Lead = {
  id: string; provider: string; title: string; company: string;
  location: string; url: string; status: string;
};
const stages = ['saved','applied','interviewing','offer','rejected','closed'];
export function ExternalLeadsWorkspace() {
  const [items, setItems] = useState<Lead[]>([]);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  async function reload() {
    try { setItems(await api('external-leads')); setError(''); }
    catch (e) { setError((e as Error).message); }
  }
  useEffect(() => { void Promise.resolve().then(reload); }, []);
  async function run(fn: () => Promise<unknown>) {
    setBusy(true); setError(''); setMessage('');
    try { await fn(); await reload(); setMessage('External leads updated.'); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  return (
    <section className="panel">
      <h2>Saved external leads</h2>
      <p>Optional bookmarks from providers that permit storage.
        Application stages are self-reported, not confirmations from employers.</p>
      {error && <Notice error>{error}</Notice>}
      {message && <Notice>{message}</Notice>}
      {!items.length && <Empty title="No external leads saved">
        Search the configured providers to bookmark an authorized result.
      </Empty>}
      {items.map(item => (
        <div className="workspace-row" key={item.id}>
          <div>
            <h3>{item.title}</h3>
            <p>{item.company} · {item.location} · {item.provider}</p>
            <p><a href={item.url} target="_blank" rel="noopener noreferrer">View provider posting</a></p>
            {item.provider === 'jooble' && (
              <p><a href="https://jooble.org" target="_blank" rel="noopener noreferrer">
                Jobs powered by Jooble
              </a></p>
            )}
            <label>
              Self-tracked status
              <select
                value={item.status}
                disabled={busy}
                onChange={event => void run(() => api('external-leads/' + item.id, 'PATCH', {
                  status: event.target.value,
                }))}
              >
                {stages.map(stage => <option key={stage} value={stage}>{stage}</option>)}
              </select>
            </label>
          </div>
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => void run(() => api('external-leads/' + item.id, 'DELETE'))}
          >Remove</Button>
        </div>
      ))}
    </section>
  );
}

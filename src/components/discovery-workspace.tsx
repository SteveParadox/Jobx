'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { api } from './actions';
import { Button, Notice } from './ui';

type Candidate = {
  id: string;
  canonicalUrl: string;
  hostname: string;
  provider: string | null;
  boardToken: string | null;
  state: string;
  requiresPermissionReview: boolean;
  evidence: unknown;
  firstDiscoveredAt: string;
  lastObservedAt: string;
  reviewedAt: string | null;
  reviewNote: string | null;
};
type Run = {
  id: string;
  trigger: string;
  status: string;
  seedsSeen: number;
  candidatesFound: number;
  candidatesUpdated: number;
  rejected: number;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
};
type Snapshot = { candidates: Candidate[]; runs: Run[]; configured: boolean };

const when = (value?: string | null) => value ? new Date(value).toLocaleString() : 'Not recorded';

export function DiscoveryWorkspace() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [seeds, setSeeds] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function refresh() {
    try {
      setSnapshot(await api('admin/discovery') as Snapshot);
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => { void Promise.resolve().then(refresh); }, []);

  async function runDiscovery(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setMessage(''); setError('');
    try {
      const result = await api('admin/discovery/run', 'POST', { seeds: seeds.trim() || undefined }) as {
        skipped?: boolean; reason?: string; seedsSeen?: number; candidatesFound?: number;
        candidatesUpdated?: number; rejected?: number;
      };
      setMessage(result.skipped
        ? 'Discovery was skipped: ' + (result.reason ?? 'no configured seeds') + '.'
        : `Discovery completed. New: ${result.candidatesFound ?? 0}, updated: ${result.candidatesUpdated ?? 0}, rejected: ${result.rejected ?? 0}.`);
      await refresh();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  async function review(candidate: Candidate, form: HTMLFormElement) {
    const data = new FormData(form);
    setBusy(true); setMessage(''); setError('');
    try {
      await api('admin/discovery/' + candidate.id, 'PATCH', {
        state: data.get('state'),
        note: data.get('note'),
      });
      setMessage('Candidate review saved. This does not approve scraping or redistribution.');
      await refresh();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  async function createSourceDraft(candidate: Candidate, form: HTMLFormElement) {
    const data = new FormData(form);
    const permittedFields = data.getAll('permittedFields').map(String);
    const applicationHostnames = String(data.get('applicationHostnames') ?? '')
      .split(/[\\n,;]+/).map((value) => value.trim().toLowerCase()).filter(Boolean);
    setBusy(true); setMessage(''); setError('');
    try {
      await api('admin/discovery/' + candidate.id + '/source-draft', 'POST', {
        employerId: String(data.get('employerId') ?? '').trim(),
        permissionEvidence: String(data.get('permissionEvidence') ?? '').trim(),
        attribution: String(data.get('attribution') ?? '').trim(),
        permittedFields,
        removalPolicy: String(data.get('removalPolicy') ?? '').trim(),
        intervalMinutes: Number(data.get('intervalMinutes') ?? 60),
        applicationHostnames,
        usageConditions: String(data.get('usageConditions') ?? '').trim(),
        authorizationExpiresAt: data.get('authorizationExpiresAt')
          ? new Date(String(data.get('authorizationExpiresAt'))).toISOString()
          : null,
      });
      setMessage('Disabled source draft created. It still requires source approval and a successful source test.');
      await refresh();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <div className="stack">
      <section className="panel">
        <h2>Autonomous source discovery</h2>
        <p>
          Discoveries create a review queue only. They never grant source permission, enable
          ingestion, or publish jobs. Supply employer career pages or known ATS board URLs, one per
          line. HTTPS public hostnames only; up to 25 unique seeds per run.
        </p>
        <div className="stats">
          <div className="stat"><strong>{snapshot?.candidates.length ?? '—'}</strong><span>Recent candidates</span></div>
          <div className="stat"><strong>{snapshot?.candidates.filter((c) => c.state !== 'REJECTED').length ?? '—'}</strong><span>Active review queue</span></div>
          <div className="stat"><strong>{snapshot?.runs.length ?? '—'}</strong><span>Recent runs</span></div>
          <div className="stat"><strong>{snapshot?.configured ? 'Enabled' : 'Manual only'}</strong><span>Worker schedule</span></div>
        </div>
        {error && <Notice error>{error}</Notice>}
        {message && <Notice>{message}</Notice>}
        <form className="stack" onSubmit={runDiscovery}>
          <label>
            Seed URLs
            <textarea
              value={seeds}
              onChange={(event) => setSeeds(event.target.value)}
              rows={5}
              maxLength={10000}
              placeholder={'https://example.com/careers\nhttps://jobs.ashbyhq.com/example'}
              aria-describedby="discovery-seeds-help"
            />
          </label>
          <p id="discovery-seeds-help">Leave blank to use JOB_DISCOVERY_SEEDS configured for the server. Manual runs bypass the scheduled interval but remain bounded.</p>
          <div className="row-actions">
            <Button disabled={busy}>{busy ? 'Working…' : 'Run discovery now'}</Button>
            <Button type="button" variant="secondary" disabled={busy} onClick={() => void refresh()}>Refresh queue</Button>
          </div>
        </form>
      </section>

      <section className="panel">
        <h2>Candidate review queue</h2>
        {!snapshot?.candidates.length && <p>No candidates yet. Configure seeds or run discovery above.</p>}
        {snapshot?.candidates.map((candidate) => (
          <article className="panel" key={candidate.id}>
            <div className="workspace-row">
              <div>
                <h3>{candidate.provider ?? 'Unclassified source'}{candidate.boardToken ? ' · ' + candidate.boardToken : ''}</h3>
                <p><a href={candidate.canonicalUrl} target="_blank" rel="noopener noreferrer">{candidate.canonicalUrl}</a></p>
                <p>{candidate.hostname} · {candidate.state} · Permission review required</p>
                <p>First discovered: {when(candidate.firstDiscoveredAt)} · Last observed: {when(candidate.lastObservedAt)}</p>
                {candidate.reviewNote && <p>Last review: {candidate.reviewNote}</p>}
                <details>
                  <summary>Evidence</summary>
                  <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{JSON.stringify(candidate.evidence, null, 2)}</pre>
                </details>
              </div>
            </div>
            <form className="form-grid" onSubmit={(event) => { event.preventDefault(); void review(candidate, event.currentTarget); }}>
              <label>
                Review state
                <select name="state" defaultValue={candidate.state === 'REJECTED' ? 'REJECTED' : candidate.state === 'IDENTIFIED' ? 'IDENTIFIED' : 'REVIEW_REQUIRED'}>
                  <option value="IDENTIFIED">Identified, needs source setup</option>
                  <option value="REVIEW_REQUIRED">Keep in permission review</option>
                  <option value="REJECTED">Reject candidate</option>
                </select>
              </label>
              <label>
                Review note (required)
                <input name="note" minLength={10} maxLength={2000} required defaultValue={candidate.reviewNote ?? ''} placeholder="Explain identity/permission checks or rejection reason" />
              </label>
              <Button variant="secondary" disabled={busy}>Save review</Button>
            </form>
            {candidate.state === 'IDENTIFIED' && candidate.provider && candidate.boardToken && (
              <details className="panel">
                <summary>Create disabled source draft</summary>
                <p>Only use this after verifying the employer and recording explicit permission. Draft creation does not approve or enable ingestion.</p>
                <form className="form-grid" onSubmit={(event) => { event.preventDefault(); void createSourceDraft(candidate, event.currentTarget); }}>
                  <label>Verified employer ID<input name="employerId" required pattern="[0-9a-fA-F-]{36}" placeholder="Employer UUID" /></label>
                  <label>Permission evidence<textarea name="permissionEvidence" required minLength={20} maxLength={10000} placeholder="Link or record documenting explicit access, storage, and redistribution rights" /></label>
                  <label>Attribution<input name="attribution" required minLength={2} maxLength={500} defaultValue={candidate.hostname} /></label>
                  <label>Application hostnames<input name="applicationHostnames" required placeholder="jobs.example.com, careers.example.com" /></label>
                  <label>Usage conditions<textarea name="usageConditions" required minLength={10} maxLength={5000} placeholder="Permitted fields, display, storage, attribution, and redistribution scope" /></label>
                  <label>Removal policy<textarea name="removalPolicy" required minLength={10} maxLength={2000} placeholder="How removed, expired, or unauthorized listings will be handled" /></label>
                  <label>Sync interval (minutes)<input name="intervalMinutes" type="number" min={15} max={10080} defaultValue={60} required /></label>
                  <label>Authorization expiry (optional)<input name="authorizationExpiresAt" type="date" /></label>
                  <fieldset>
                    <legend>Permitted fields</legend>
                    {['title', 'description', 'location', 'application', 'date', 'salary', 'skills', 'employment', 'experience'].map((field) => (
                      <label key={field}><input type="checkbox" name="permittedFields" value={field} defaultChecked={['title', 'description', 'location', 'application'].includes(field)} /> {field}</label>
                    ))}
                  </fieldset>
                  <Button disabled={busy}>Create pending source draft</Button>
                </form>
              </details>
            )}
          </article>
        ))}
      </section>

      <section className="panel">
        <h2>Discovery run history</h2>
        {!snapshot?.runs.length && <p>No discovery runs recorded.</p>}
        {snapshot?.runs.map((run) => (
          <div className="workspace-row" key={run.id}>
            <div>
              <h3>{run.status} · {when(run.startedAt)}</h3>
              <p>{run.trigger} · Seeds {run.seedsSeen} · New {run.candidatesFound} · Updated {run.candidatesUpdated} · Rejected {run.rejected}</p>
              {run.error && <Notice error>{run.error}</Notice>}
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}

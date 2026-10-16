'use client';
import type { adminOverview } from '@/domain/admin';
import type { ingestionOverview } from '@/domain/ingestion-tasks';
import { useEffect, useState } from 'react';
import { api } from './actions';
import { Button, Notice } from './ui';
type Serialized<T> = T extends Date
  ? string
  : T extends (infer U)[]
    ? Serialized<U>[]
    : T extends object
      ? { [K in keyof T]: Serialized<T[K]> }
      : T;
type Data = Serialized<Awaited<ReturnType<typeof adminOverview>>>;
type Source = Data['sources'][number]['source'];
type Health = Serialized<Awaited<ReturnType<typeof ingestionOverview>>> & {
  queue: { available: boolean; counts: Record<string, number> | null };
};
export function IngestionWorkspace({
  sources,
  companies,
  run,
}: {
  sources: Data['sources'];
  companies: Data['companies'];
  run: (fn: () => Promise<unknown>, success?: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState<Source | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState('');
  async function refresh() {
    try {
      setHealth(await api('admin/ingestion'));
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    void Promise.resolve().then(refresh);
  }, []);
  const activeTasks =
    health?.tasks.filter((task) => ['queued', 'running', 'retrying'].includes(task.status)) ?? [];
  const recent = health?.runs ?? [];
  const totals = recent.reduce(
    (all, row) => ({
      imported: all.imported + row.imported,
      updated: all.updated + row.updated,
      closed: all.closed + row.closed,
      duplicates: all.duplicates + row.duplicates,
      quarantined: all.quarantined + row.quarantined,
    }),
    { imported: 0, updated: 0, closed: 0, duplicates: 0, quarantined: 0 },
  );
  const when = (value: string | null | undefined) =>
    value ? new Date(value).toLocaleString() : 'Not recorded';
  return (
    <>
      <section className="panel">
        <h2>Authorized data, accountable updates.</h2>
        <p>
          Register the approved employer endpoint and usage conditions. Sources start disabled and
          pending approval. After approval, queue a test, inspect its records, then enable
          scheduling. Publishing is a separate explicit policy.
        </p>
        <div className="stats">
          <div className="stat">
            <strong>{sources.length}</strong>
            <span>Configured sources</span>
          </div>
          <div className="stat">
            <strong>
              {sources.filter(({ source }) => source.approvalStatus === 'approved').length}
            </strong>
            <span>Approved sources</span>
          </div>
          <div className="stat">
            <strong>{activeTasks.length}</strong>
            <span>Recent active tasks</span>
          </div>
          <div className="stat">
            <strong>{health?.queue.available ? 'Connected' : 'Unavailable'}</strong>
            <span>Redis queue</span>
          </div>
        </div>
        {error && <Notice error>{error}</Notice>}
        <Button variant="secondary" onClick={refresh}>
          Refresh ingestion health
        </Button>
        {health && (
          <p>
            Worker heartbeat: {when(health.heartbeat.find((h) => h.id === 'primary')?.updatedAt)}.
            Queue:{' '}
            {health.queue.counts
              ? Object.entries(health.queue.counts)
                  .map(([key, value]) => `${key}: ${value}`)
                  .join(' · ')
              : 'Not available'}
            .
          </p>
        )}
        <h3 style={{ marginTop: 25 }}>Most recent {recent.length} synchronization runs</h3>
        <p>
          New: {totals.imported} · Updated: {totals.updated} · Closed or expired: {totals.closed} ·
          Duplicate aliases prevented: {totals.duplicates} · Quarantined: {totals.quarantined} ·
          Failed fetch/process runs: {recent.filter((row) => row.status === 'failed').length}
        </p>
      </section>
      <SourceEditor
        key={editing ? editing.id + ':' + editing.revision : 'new-source'}
        source={editing}
        companies={companies}
        save={(values) =>
          run(
            () =>
              api(
                editing ? 'admin/sources/' + editing.id : 'admin/sources',
                editing ? 'PUT' : 'POST',
                values,
              ),
            'Source configuration saved disabled and pending approval.',
          )
        }
        cancel={() => setEditing(null)}
      />
      <section className="panel">
        <h2>Source registry</h2>
        {!sources.length && (
          <p>No live sources are configured. Add an employer-approved source above.</p>
        )}
        {sources.map(({ source, lastRun, activeJobs }) => (
          <article className="panel" key={source.id}>
            <h3>
              {companies.find((c) => c.id === source.employerId)?.name} · {source.provider} /{' '}
              {source.boardToken}
            </h3>
            <p>
              {source.approvalStatus} · {source.enabled ? 'Enabled' : 'Disabled'} · {source.health}{' '}
              · {activeJobs} active mapped jobs
            </p>
            <p>
              Endpoint: {source.endpointUrl ?? 'Authorized manual upload'}
              <br />
              Last success: {when(source.lastSuccessAt)} · Last failure:{' '}
              {when(source.lastFailureAt)} · Consecutive failures: {source.consecutiveFailures}
              <br />
              Next scheduled check: {when(source.nextSyncAt)} · Every {source.intervalMinutes}{' '}
              minutes · Revision {source.revision}
            </p>
            <p>
              Latest run: {lastRun?.status ?? 'Never run'} · {lastRun?.count ?? 0} valid records ·{' '}
              {lastRun?.requests ?? 0} requests · {lastRun?.durationMs ?? 0} ms ·{' '}
              {lastRun?.complete ? 'Complete snapshot' : 'No complete snapshot'}
            </p>
            <p>
              Attribution: {source.attribution}
              <br />
              Usage: {source.usageConditions || 'Needs completion'}
              <br />
              Removal: {source.removalPolicy}
            </p>
            {lastRun?.error && <Notice error>{lastRun.error}</Notice>}
            <div className="row-actions">
              <Button variant="secondary" onClick={() => setEditing(source)}>
                Edit configuration
              </Button>
              <Button
                variant="secondary"
                disabled={
                  source.approvalStatus !== 'approved' || source.provider.startsWith('manual_')
                }
                onClick={() =>
                  run(
                    () => api('admin/sources/' + source.id + '/test', 'POST'),
                    'Test queued. It fetches and validates without changing the public catalog.',
                  )
                }
              >
                Queue source test
              </Button>
              <Button
                variant="secondary"
                disabled={!source.enabled && source.approvalStatus !== 'approved'}
                onClick={() =>
                  run(
                    () => api('admin/sources/' + source.id, 'PATCH', { enabled: !source.enabled }),
                    'Source status updated.',
                  )
                }
              >
                {source.enabled ? 'Disable source' : 'Enable scheduling'}
              </Button>
              <Button
                disabled={!source.enabled || source.provider.startsWith('manual_')}
                onClick={() =>
                  run(
                    () => api('admin/sources/' + source.id + '/sync', 'POST'),
                    'Synchronization durably queued.',
                  )
                }
              >
                Queue synchronization
              </Button>
            </div>
            <details style={{ marginTop: 20 }}>
              <summary>Review permission and redistribution approval</summary>
              <form
                className="stack"
                onSubmit={(e) => {
                  e.preventDefault();
                  const d = new FormData(e.currentTarget);
                  void run(
                    () =>
                      api('admin/sources/' + source.id + '/review', 'POST', {
                        status: d.get('status'),
                        evidence: d.get('evidence'),
                      }),
                    'Permission review recorded.',
                  );
                }}
              >
                <label>
                  Decision
                  <select name="status">
                    <option value="approved">Approve recorded scope</option>
                    <option value="revoked">Revoke approval</option>
                  </select>
                </label>
                <label>
                  Review evidence
                  <textarea name="evidence" required minLength={20} maxLength={5000} />
                </label>
                <p>
                  Confirm actual permission, employer identity, attribution, allowed fields, access
                  policy and removal obligations. Public accessibility alone does not establish
                  redistribution rights.
                </p>
                <Button>Record source decision</Button>
              </form>
            </details>
          </article>
        ))}
      </section>
      <section className="panel">
        <h2>Durable tasks and recovery</h2>
        <p>
          Shows up to 100 recent tasks. Failed tasks are the ingestion dead-letter queue; retries
          require current source approval. Refresh after changes to inspect worker progress.
        </p>
        {health?.tasks.map((task) => (
          <div className="workspace-row" key={task.id}>
            <div>
              <h3>
                {task.kind} · {task.status}
              </h3>
              <p>
                {task.sourceId} · Attempt {task.attempts}/{task.maxAttempts} · Eligible{' '}
                {when(task.availableAt)}
                {task.cancelRequested ? ' · Cancellation requested' : ''}
              </p>
              {task.lastError && (
                <p>
                  {task.errorCode}: {task.lastError}
                </p>
              )}
            </div>
            <div className="row-actions">
              {['queued', 'running', 'retrying'].includes(task.status) && (
                <Button
                  variant="ghost"
                  onClick={() =>
                    run(async () => {
                      await api('admin/ingestion-tasks/' + task.id + '/cancel', 'POST');
                      await refresh();
                    }, 'Cancellation recorded. An in-flight HTTP request may finish before the worker stops.')
                  }
                >
                  Cancel task
                </Button>
              )}
              {['failed', 'cancelled'].includes(task.status) && (
                <Button
                  variant="secondary"
                  onClick={() =>
                    run(async () => {
                      await api('admin/ingestion-tasks/' + task.id + '/retry', 'POST');
                      await refresh();
                    }, 'Retry durably queued.')
                  }
                >
                  Retry task
                </Button>
              )}
            </div>
          </div>
        ))}
      </section>
      <section className="panel">
        <h2>Quarantine and rejected records</h2>
        <p>
          Recent validation/processing records; raw payloads are retained privately for up to 30
          days. Fix the source or mapping and queue a new test before retrying.
        </p>
        {health?.errors.map((error) => (
          <div className="workspace-row" key={error.id}>
            <div>
              <h3>
                {error.disposition} · {error.stage}
              </h3>
              <p>
                {error.externalId ?? 'Snapshot'} · {error.reason}
              </p>
            </div>
          </div>
        ))}
      </section>
    </>
  );
}
function SourceEditor({
  source,
  companies,
  save,
  cancel,
}: {
  source: Source | null;
  companies: Data['companies'];
  save: (values: unknown) => Promise<void>;
  cancel: () => void;
}) {
  const [error, setError] = useState('');
  return (
    <section className="panel">
      <h2>{source ? 'Edit source configuration' : 'Register an authorized source'}</h2>
      <form
        className="form-grid"
        onSubmit={(e) => {
          e.preventDefault();
          const d = new FormData(e.currentTarget);
          let config: unknown;
          try {
            config = JSON.parse(String(d.get('config') || '{}'));
            setError('');
          } catch {
            setError('Adapter configuration must be valid JSON.');
            return;
          }
          void save({
            employerId: d.get('employerId'),
            provider: d.get('provider'),
            boardToken: d.get('boardToken'),
            ...(d.get('endpointUrl') ? { endpointUrl: d.get('endpointUrl') } : {}),
            applicationHostnames: String(d.get('applicationHostnames'))
              .split(/[\s,]+/)
              .filter(Boolean),
            permissionEvidence: d.get('permissionEvidence'),
            usageConditions: d.get('usageConditions'),
            attribution: d.get('attribution'),
            removalPolicy: d.get('removalPolicy'),
            intervalMinutes: Number(d.get('intervalMinutes')),
            missingConfirmations: Number(d.get('missingConfirmations')),
            missingGraceMinutes: Number(d.get('missingGraceMinutes')),
            authorizationExpiresAt: d.get('authorizationExpiresAt')
              ? String(d.get('authorizationExpiresAt')) + ':00Z'
              : null,
            permittedFields: d.getAll('permittedFields'),
            autoPublish: d.get('autoPublish') === 'on',
            enabled: false,
            config,
          });
        }}
      >
        <label>
          Employer
          <select name="employerId" required defaultValue={source?.employerId}>
            {companies.map((c) => (
              <option value={c.id} key={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Provider
          <select name="provider" defaultValue={source?.provider ?? 'greenhouse'}>
            {[
              'greenhouse',
              'lever',
              'lever_eu',
              'ashby',
              'authorized_json',
              'authorized_xml',
              'authorized_rss',
              'authorized_html',
              'authorized_browser',
              'licensed_json',
              'manual_json',
              'manual_csv',
              'manual_xml',
            ].map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </label>
        <label>
          Board or source identifier
          <input
            name="boardToken"
            defaultValue={source?.boardToken}
            required
            pattern="[a-zA-Z0-9_-]{1,100}"
          />
        </label>
        <label>
          Approved HTTPS endpoint (custom feeds/pages)
          <input name="endpointUrl" type="url" defaultValue={source?.endpointUrl ?? ''} />
        </label>
        <label className="full-width">
          Approved application/job-page hostnames, comma separated
          <input
            name="applicationHostnames"
            defaultValue={source?.applicationHostnames.join(', ')}
            required
            placeholder="jobs.example.com, careers.example.com"
          />
        </label>
        <label>
          Attribution
          <input
            name="attribution"
            defaultValue={source?.attribution}
            required
            minLength={2}
            maxLength={500}
          />
        </label>
        <label>
          Authorization expiry (UTC, optional)
          <input
            name="authorizationExpiresAt"
            type="datetime-local"
            defaultValue={source?.authorizationExpiresAt?.slice(0, 16)}
          />
        </label>
        <label className="full-width">
          Authorization and redistribution evidence
          <textarea
            name="permissionEvidence"
            defaultValue={source?.permissionEvidence}
            required
            minLength={20}
            maxLength={10000}
          />
        </label>
        <label className="full-width">
          Allowed usage and attribution conditions
          <textarea
            name="usageConditions"
            defaultValue={source?.usageConditions}
            required
            minLength={10}
            maxLength={5000}
          />
        </label>
        <label className="full-width">
          Removal obligations
          <textarea
            name="removalPolicy"
            defaultValue={source?.removalPolicy}
            required
            minLength={10}
            maxLength={2000}
          />
        </label>
        <fieldset className="full-width">
          <legend>Fields authorized for display</legend>
          {[
            'title',
            'description',
            'location',
            'application',
            'date',
            'salary',
            'skills',
            'employment',
            'experience',
          ].map((field) => (
            <label className="checkbox" key={field}>
              <input
                type="checkbox"
                name="permittedFields"
                value={field}
                defaultChecked={
                  source
                    ? source.permittedFields.includes(field)
                    : ['title', 'description', 'location', 'application'].includes(field)
                }
              />
              {field}
            </label>
          ))}
        </fieldset>
        <label>
          Fetch interval (minutes)
          <input
            name="intervalMinutes"
            type="number"
            min={15}
            max={10080}
            defaultValue={source?.intervalMinutes ?? 60}
            required
          />
        </label>
        <label>
          Absence confirmations
          <input
            name="missingConfirmations"
            type="number"
            min={2}
            max={10}
            defaultValue={source?.missingConfirmations ?? 2}
            required
          />
        </label>
        <label>
          Minimum gap between confirmations (minutes)
          <input
            name="missingGraceMinutes"
            type="number"
            min={15}
            max={10080}
            defaultValue={source?.missingGraceMinutes ?? 60}
            required
          />
        </label>
        <label className="checkbox">
          <input name="autoPublish" type="checkbox" defaultChecked={source?.autoPublish} />
          Allow automatic publication of valid records with known workplace/location semantics after
          source approval.
        </label>
        <label className="full-width">
          Adapter settings (JSON)
          <textarea
            name="config"
            rows={8}
            defaultValue={JSON.stringify(source?.config ?? { robots: true }, null, 2)}
          />
        </label>
        <p className="full-width">
          Adapter settings control request/page limits, field paths, selectors and complete-feed
          policy. RSS requires fullCatalog=true only when the approved contract guarantees a
          complete active catalog. Browser sources also require browserPermitted=true and operator
          configuration. Editing revokes prior approval and requires another test.
        </p>
        {error && <Notice error>{error}</Notice>}
        <div className="row-actions">
          <Button>Save source disabled</Button>
          {source && (
            <Button type="button" variant="ghost" onClick={cancel}>
              New source instead
            </Button>
          )}
        </div>
      </form>
    </section>
  );
}

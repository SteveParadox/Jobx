'use client';
import type { adminOverview, seoHealth } from '@/domain/admin';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from './actions';
import { IngestionWorkspace } from './ingestion-workspace';
import { DiscoveryWorkspace } from './discovery-workspace';
import { MetricsPanel } from './metrics-panel';
import { Button, Notice } from './ui';
type Serialized<T> = T extends Date
  ? string
  : T extends (infer U)[]
    ? Serialized<U>[]
    : T extends object
      ? { [K in keyof T]: Serialized<T[K]> }
      : T;
type Data = Serialized<Awaited<ReturnType<typeof adminOverview>>>;
export function AdminWorkspace() {
  const [data, setData] = useState<Data | null>(null);
  const [seo, setSeo] = useState<Serialized<Awaited<ReturnType<typeof seoHealth>>> | null>(null);
  const [tab, setTab] = useState('Moderation');
  const [message, setMessage] = useState('');
  const [denied, setDenied] = useState('');
  const [busy, setBusy] = useState(false);
  async function load() {
    try {
      const d = await api('admin/overview');
      setData(d);
    } catch (e) {
      setDenied((e as Error).message);
    }
  }
  useEffect(() => {
    void Promise.resolve().then(load);
  }, []);
  async function run(fn: () => Promise<unknown>, success = 'Saved and recorded in the audit log.') {
    setBusy(true);
    setMessage('');
    try {
      await fn();
      await load();
      setMessage(success);
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (denied)
    return (
      <div className="container page-container">
        <Notice error>{denied}</Notice>
        <h1 style={{ marginTop: 30 }}>Administrator access required.</h1>
        <Link href="/auth" className="button button-primary">
          Sign in
        </Link>
      </div>
    );
  if (!data)
    return (
      <div className="container page-container" role="status">
        Loading administration…
      </div>
    );
  return (
    <div className="container workspace">
      <div className="workspace-title">
        <div>
          <div className="eyebrow">PLATFORM OPERATIONS</div>
          <h1>Trust is built in the details.</h1>
        </div>
        <Button variant="secondary" onClick={load}>
          Refresh
        </Button>
      </div>
      <div className="stats">
        {data.jobCounts.map((v) => (
          <div className="stat" key={v.status}>
            <strong>{v.count}</strong>
            <span>{v.status} jobs</span>
          </div>
        ))}
      </div>
      <div className="workspace-tabs" role="tablist" aria-label="Administration sections">
        {[
          'Moderation',
          'Employers',
          'Sources',
          'Discovery',
          'Reports',
          'SEO',
          'Analytics',
          'Content',
          'Payments',
          'Users',
          'Security',
          'Support',
          'Audit log',
        ].map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => {
              setTab(t);
              if (t === 'SEO')
                api('admin/seo')
                  .then(setSeo)
                  .catch((e) => setMessage(e.message));
            }}
          >
            {t}
          </button>
        ))}
      </div>
      {message && (
        <div style={{ marginBottom: 20 }}>
          <Notice>{message}</Notice>
        </div>
      )}
      {tab === 'Moderation' && (
        <section>
          <h2>Review before reach.</h2>
          <p>
            Verify source permission, accurate employer identity, complete job description and a
            trustworthy application destination. Imported location and dates may need authorized
            confirmation.
          </p>
          {!data.pendingJobs.length && <p>No jobs are waiting for moderation.</p>}
          {data.pendingJobs.map(({ job: j, company }) => (
            <div className="panel" key={j.id}>
              <div className="workspace-row">
                <div>
                  <h3>{j.title}</h3>
                  <p>
                    {company} · {j.locationLabel}
                  </p>
                  <p>Application destination: {j.applyUrl ?? 'Native application'}</p>
                </div>
                <div className="row-actions">
                  <Button
                    disabled={busy}
                    onClick={() =>
                      run(
                        () =>
                          api('jobs/' + j.id + '/transition', 'POST', {
                            action: j.status === 'paused' ? 'submit' : 'publish',
                          }),
                        'Job published after review.',
                      )
                    }
                  >
                    {j.status === 'paused' ? 'Return to review' : 'Approve & publish'}
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={busy}
                    onClick={() =>
                      run(
                        () => api('jobs/' + j.id + '/transition', 'POST', { action: 'reject' }),
                        'Job rejected.',
                      )
                    }
                  >
                    Reject
                  </Button>
                </div>
              </div>
              <details>
                <summary>Review description & confirm structured fields</summary>
                <div className="prose" dangerouslySetInnerHTML={{ __html: j.descriptionHtml }} />
                <form
                  className="form-grid"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const d = new FormData(e.currentTarget);
                    const job: Record<string, unknown> = Object.fromEntries(
                      Object.entries(j).filter(([, v]) => v !== null),
                    );
                    job.country = d.get('country') || null;
                    job.city = d.get('city') || undefined;
                    job.workplace = d.get('workplace');
                    job.remoteCountries = String(d.get('remoteCountries'))
                      .split(',')
                      .map((x) => x.trim().toUpperCase())
                      .filter(Boolean);
                    job.originalPostedAt = d.get('originalPostedAt')
                      ? new Date(String(d.get('originalPostedAt')) + 'Z').toISOString()
                      : null;
                    job.applicationMethod = j.applicationMethod;
                    void run(
                      () =>
                        api(`employers/${j.employerId}/jobs/${j.id}`, 'PUT', {
                          job,
                          expectedVersion: j.version,
                        }),
                      'Verified fields saved. Review again before publication.',
                    );
                  }}
                >
                  <label>
                    Confirmed country code
                    <input
                      name="country"
                      defaultValue={j.country ?? ''}
                      pattern="[A-Z]{2}"
                      maxLength={2}
                    />
                  </label>
                  <label>
                    City
                    <input name="city" defaultValue={j.city ?? ''} />
                  </label>
                  <label>
                    Workplace
                    <select name="workplace" defaultValue={j.workplace}>
                      {['unknown', 'remote', 'hybrid', 'onsite'].map((v) => (
                        <option key={v}>{v}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Confirmed remote applicant country codes
                    <input name="remoteCountries" defaultValue={j.remoteCountries.join(', ')} />
                  </label>
                  <label>
                    Confirmed original posting date (UTC, leave blank if unknown)
                    <input
                      type="datetime-local"
                      name="originalPostedAt"
                      defaultValue={
                        j.originalPostedAt
                          ? new Date(j.originalPostedAt).toISOString().slice(0, 16)
                          : ''
                      }
                    />
                  </label>
                  <Button variant="secondary" disabled={busy}>
                    Save verified details
                  </Button>
                </form>
              </details>
            </div>
          ))}
        </section>
      )}
      {tab === 'Employers' && (
        <section className="panel">
          <h2>Verify who is hiring.</h2>
          {data.companies.map((c) => (
            <div className="workspace-row" key={c.id}>
              <div>
                <h3>{c.name}</h3>
                <p>
                  <a href={c.website} target="_blank" rel="noopener noreferrer">
                    {c.website}
                  </a>{' '}
                  · {c.verificationStatus}
                  {c.disabled ? ' · Disabled' : ''}
                </p>
                <code className="inline-code">{c.id}</code>
                <form
                  className="row-actions"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const d = new FormData(e.currentTarget);
                    void run(() =>
                      api(`admin/employers/${c.id}/verify`, 'POST', {
                        status: d.get('status'),
                        evidence: d.get('evidence'),
                      }),
                    );
                  }}
                >
                  <label className="sr-only" htmlFor={'status' + c.id}>
                    Verification status
                  </label>
                  <select id={'status' + c.id} name="status" style={{ width: 'auto' }}>
                    <option value="verified">Verified</option>
                    <option value="rejected">Rejected</option>
                  </select>
                  <label className="sr-only" htmlFor={'evidence' + c.id}>
                    Verification evidence
                  </label>
                  <input
                    id={'evidence' + c.id}
                    name="evidence"
                    minLength={20}
                    required
                    placeholder="Evidence and authorization checked"
                    style={{ width: 'auto' }}
                  />
                  <Button variant="secondary" disabled={busy}>
                    Record decision
                  </Button>
                </form>
              </div>
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() =>
                  run(() => api('admin/employers/' + c.id, 'PATCH', { disabled: !c.disabled }))
                }
              >
                {c.disabled ? 'Restore access' : 'Disable employer'}
              </Button>
            </div>
          ))}
        </section>
      )}
      {tab === 'Sources' && (
        <IngestionWorkspace sources={data.sources} companies={data.companies} run={run} />
      )}
      {tab === 'Discovery' && <DiscoveryWorkspace />}
      {tab === 'Sources' && (
        <section className="panel">
          <h2>Import an authorized complete snapshot</h2>
          <p>
            Maximum 180 KB / 1,000 records. This must contain every currently open record for the
            selected manual source; confirmed absences are reconciled across spaced successful
            snapshots.
          </p>
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              const d = new FormData(e.currentTarget);
              void run(
                () =>
                  api('admin/import', 'POST', {
                    sourceId: d.get('sourceId'),
                    format: d.get('format'),
                    content: d.get('content'),
                    completeSnapshot: true,
                  }),
                'Validated complete snapshot durably queued for ingestion.',
              );
            }}
          >
            <label>
              Manual source
              <select name="sourceId" required>
                {data.sources
                  .filter((v) => v.source.provider.startsWith('manual_'))
                  .map(({ source: s }) => (
                    <option key={s.id} value={s.id}>
                      {s.boardToken} · {s.provider}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Format
              <select name="format">
                <option value="json">JSON</option>
                <option value="csv">CSV</option>
                <option value="xml">XML</option>
              </select>
            </label>
            <label>
              Complete source content
              <textarea name="content" required rows={10} maxLength={180000} />
            </label>
            <label className="checkbox">
              <input type="checkbox" required />I confirm this is an authorized, complete snapshot
              and the configured display permissions cover these fields.
            </label>
            <Button disabled={busy}>Validate & queue import</Button>
          </form>
        </section>
      )}
      {tab === 'Reports' && (
        <section className="panel">
          <h2>Review the warning signs.</h2>
          {data.reports.map((r) => (
            <div className="workspace-row" key={r.id}>
              <div>
                <h3>Job report</h3>
                <p>{r.reason}</p>
                <code>{r.jobId}</code>
                <form
                  className="stack"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void run(() =>
                      api('admin/reports/' + r.id, 'PATCH', {
                        resolution: new FormData(e.currentTarget).get('resolution'),
                      }),
                    );
                  }}
                >
                  <label>
                    Resolution
                    <textarea name="resolution" required minLength={10} />
                  </label>
                  <Button disabled={busy}>Resolve report</Button>
                </form>
              </div>
            </div>
          ))}
          {!data.reports.length && <p>No open reports.</p>}
        </section>
      )}
      {tab === 'Analytics' && <MetricsPanel />}
      {tab === 'SEO' && (
        <section className="panel">
          <h2>Index only what earns its place.</h2>
          {seo ? (
            <>
              <div className="stats">
                <div className="stat">
                  <strong>{seo.indexableActiveJobs}</strong>
                  <span>Eligible active jobs in sample</span>
                </div>
                <div className="stat">
                  <strong>{seo.schemaInvalid.length}</strong>
                  <span>Ineligible records in sample</span>
                </div>
                <div className="stat">
                  <strong>{seo.expiredAwaitingWorker}</strong>
                  <span>Expired records awaiting worker</span>
                </div>
              </div>
              <p>
                Sample: {seo.sampleSize} of up to {seo.sampleLimit}. Staging noindex:{' '}
                {String(seo.stagingNoindex)}. Indexing API enabled: {String(seo.indexingEnabled)}.
              </p>
              <p>{seo.canonicalPolicy}</p>
              <p>
                Search Console: {seo.searchConsole}. Organic performance: {seo.organicPerformance}.
              </p>
              <p>{seo.linkAudit}</p>
              <a href="/sitemap.xml" className="text-link">
                Inspect sitemap index →
              </a>
              {seo.schemaInvalid.map((v) => (
                <p key={v.id}>
                  {v.title} · {v.reason}
                </p>
              ))}
            </>
          ) : (
            <p>Loading SEO diagnostics…</p>
          )}
        </section>
      )}
      {tab === 'Content' && (
        <section className="panel">
          <h2>Useful guidance, human reviewed.</h2>
          <form
            className="form-grid"
            onSubmit={(e) => {
              e.preventDefault();
              const d = new FormData(e.currentTarget);
              void run(
                () =>
                  api('admin/editorial', 'POST', {
                    slug: d.get('slug'),
                    title: d.get('title'),
                    summary: d.get('summary'),
                    bodyHtml: d.get('bodyHtml'),
                    author: d.get('author'),
                    published: d.get('published') === 'on',
                  }),
                'Editorial page saved.',
              );
            }}
          >
            <label>
              URL slug
              <input name="slug" required pattern="[a-z0-9-]{2,100}" />
            </label>
            <label>
              Title
              <input name="title" required minLength={5} />
            </label>
            <label>
              Author
              <input name="author" required minLength={2} />
            </label>
            <label className="full-width">
              Summary
              <textarea name="summary" minLength={30} maxLength={300} required />
            </label>
            <label className="full-width">
              Body HTML
              <textarea name="bodyHtml" minLength={100} rows={10} required />
            </label>
            <label className="checkbox">
              <input type="checkbox" name="published" />
              Publish after editorial review
            </label>
            <Button disabled={busy}>Save editorial page</Button>
          </form>
          <h3 style={{ marginTop: 30 }}>Stored pages</h3>
          {data.content.map((c) => (
            <p key={c.id}>
              {c.title} · {c.slug} · {c.published ? 'Published' : 'Draft'}
            </p>
          ))}
        </section>
      )}
      {tab === 'Content' && (
        <section className="panel">
          <h2>Curate a useful browse page</h2>
          <p>
            Pages return 404 and stay out of sitemaps until approved, with at least three matching
            active jobs. Write distinct, useful guidance rather than repeating keyword combinations.
          </p>
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              const d = new FormData(e.currentTarget);
              try {
                const filters = JSON.parse(String(d.get('filters')));
                void run(
                  () =>
                    api('admin/landings', 'POST', {
                      path: d.get('path'),
                      content: {
                        title: d.get('title'),
                        description: d.get('description'),
                        bodyHtml: d.get('bodyHtml'),
                        filters,
                        approved: d.get('approved') === 'on',
                      },
                    }),
                  'Curated page saved; inventory policy controls publication.',
                );
              } catch {
                setMessage('Search filters must be valid JSON.');
              }
            }}
          >
            <label>
              Browse path
              <input
                name="path"
                required
                pattern="/jobs/[a-z0-9-]+(/[a-z0-9-]+){0,2}"
                placeholder="/jobs/nigeria/lagos"
              />
            </label>
            <label>
              Title
              <input name="title" required minLength={10} maxLength={160} />
            </label>
            <label>
              Unique description
              <textarea name="description" required minLength={50} maxLength={300} />
            </label>
            <label>
              Distinct guidance HTML
              <textarea name="bodyHtml" required minLength={300} maxLength={20000} />
            </label>
            <label>
              Search filters JSON
              <textarea name="filters" required defaultValue={'{"country":"NG","city":"Lagos"}'} />
            </label>
            <label className="checkbox">
              <input type="checkbox" name="approved" />
              Editorial and inventory policy reviewed
            </label>
            <Button disabled={busy}>Save curated browse page</Button>
          </form>
        </section>
      )}
      {tab === 'Payments' && (
        <section className="panel">
          <h2>Verified transactions, durable access.</h2>
          {data.payments.map((p) => (
            <div className="workspace-row" key={p.id}>
              <div>
                <h3>
                  {p.provider} · {p.status}
                </h3>
                <p>
                  {p.currency} {(p.amount / 100).toLocaleString()} · {p.reference}
                </p>
              </div>
              {p.status === 'pending' && (
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() =>
                    run(
                      () => api('admin/checkout/' + p.id + '/reconcile', 'POST'),
                      'Provider verification completed.',
                    )
                  }
                >
                  Reconcile
                </Button>
              )}
            </div>
          ))}
          <h3>Fixed-period subscriptions</h3>
          {data.subscriptions.map((s) => (
            <p key={s.id}>
              {s.planId} · {s.status} · Ends {new Date(s.endsAt).toLocaleDateString()}
            </p>
          ))}
          <p>
            Automatic recurring charges are not enabled. Partial refunds require accounting review;
            paid access is never activated from redirect parameters.
          </p>
        </section>
      )}
      {tab === 'Users' && (
        <section className="panel">
          <h2>Account administration</h2>
          {data.users.map((u) => (
            <div className="workspace-row" key={u.id}>
              <div>
                <h3>{u.name}</h3>
                <p>
                  {u.email} · {u.role} · {u.disabled ? 'Disabled' : 'Enabled'}
                </p>
              </div>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() =>
                  run(() => api('admin/users/' + u.id, 'PATCH', { disabled: !u.disabled }))
                }
              >
                {u.disabled ? 'Restore' : 'Disable account'}
              </Button>
            </div>
          ))}
        </section>
      )}
      {tab === 'Security' && (
        <section className="panel">
          <h2>Quarantine protects candidate documents.</h2>
          <p>
            Reviewers must scan the exact object and record its SHA-256 and scanner result before
            marking clean. No quarantined document can be downloaded or attached to an application
            through the public application.
          </p>
          {data.quarantine.map((r) => (
            <div className="workspace-row" key={r.id}>
              <div>
                <h3>{r.filename}</h3>
                <p>Object: {r.id}</p>
                <code className="inline-code">SHA-256: {r.sha256}</code>
                <form
                  className="stack"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const d = new FormData(e.currentTarget);
                    void run(() =>
                      api('admin/resumes/' + r.id + '/review', 'POST', {
                        status: d.get('status'),
                        evidence: d.get('evidence'),
                      }),
                    );
                  }}
                >
                  <label>
                    Review status
                    <select name="status">
                      <option value="rejected">Reject</option>
                      <option value="clean">Clean scan confirmed</option>
                    </select>
                  </label>
                  <label>
                    Scanner evidence, exact hash & review result
                    <textarea name="evidence" required minLength={30} />
                  </label>
                  <Button variant="secondary" disabled={busy}>
                    Record security review
                  </Button>
                </form>
              </div>
            </div>
          ))}
          <h3>Delivery exceptions</h3>
          {data.failedDeliveries.map((d) => (
            <p key={d.id}>
              {d.id} · {d.status} · {d.lastError ?? 'Awaiting worker'}
            </p>
          ))}
        </section>
      )}
      {tab === 'Support' && (
        <section className="panel">
          <h2>Support inbox</h2>
          {data.support.map((s) => (
            <div className="workspace-row" key={s.id}>
              <div>
                <h3>{s.subject}</h3>
                <p>{s.email}</p>
                <p>{s.body}</p>
              </div>
              <Button
                disabled={busy}
                onClick={() => run(() => api('admin/support/' + s.id, 'PATCH'))}
              >
                Mark resolved
              </Button>
            </div>
          ))}
        </section>
      )}
      {tab === 'Audit log' && (
        <section className="panel">
          <h2>Actions with an accountable history.</h2>
          {data.audits.map((a) => (
            <div className="workspace-row" key={a.id}>
              <div>
                <h3>{a.action}</h3>
                <p>
                  {a.entityId} · {new Date(a.createdAt).toLocaleString()} · Actor{' '}
                  {a.actorId ?? 'system'}
                </p>
              </div>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}

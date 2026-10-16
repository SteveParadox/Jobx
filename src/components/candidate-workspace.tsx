'use client';
import type { candidateDashboard } from '@/domain/candidates';
import { searchHref, searchSummary } from '@/domain/search-state';
import { jobPath } from '@/domain/seo';
import { authClient } from '@/lib/auth-client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { AlertForm, api } from './actions';
import { SearchPreferenceEditor } from './search-preference-editor';
import { Button, Empty, Notice } from './ui';
type Data = Awaited<ReturnType<typeof candidateDashboard>>;
type Serialized<T> = T extends Date
  ? string
  : T extends (infer U)[]
    ? Serialized<U>[]
    : T extends object
      ? { [P in keyof T]: Serialized<T[P]> }
      : T;
export function CandidateWorkspace() {
  const router = useRouter();
  const [data, setData] = useState<Serialized<Data> | null>(null);
  const [tab, setTab] = useState('Overview');
  const [message, setMessage] = useState('');
  const [error, setError] = useState(false);
  const [initialError, setInitialError] = useState('');
  const [busy, setBusy] = useState(false);
  const [editingAlert, setEditingAlert] = useState<string | null>(null);
  const [resumingAlert, setResumingAlert] = useState<string | null>(null);
  const [editingSearch, setEditingSearch] = useState<string | null>(null);
  async function load() {
    try {
      setData(await api('dashboard'));
      setInitialError('');
    } catch (e) {
      setInitialError((e as Error).message);
    }
  }
  useEffect(() => {
    void Promise.resolve().then(load);
  }, []);
  async function run(fn: () => Promise<unknown>, success = 'Saved.', onSuccess?: () => void) {
    setBusy(true);
    setMessage('');
    setError(false);
    try {
      await fn();
      await load();
      setMessage(success);
      onSuccess?.();
    } catch (e) {
      setError(true);
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (initialError)
    return (
      <div className="container page-container">
        <Notice error>{initialError}</Notice>
        <div className="row-actions" style={{ marginTop: 20 }}>
          <Link href="/auth" className="button button-primary">
            Sign in or create an account
          </Link>
          <Button variant="secondary" onClick={load}>
            Try again
          </Button>
        </div>
      </div>
    );
  if (!data)
    return (
      <div className="container page-container" role="status">
        <div className="skeleton" />
        Loading your workspace…
      </div>
    );
  return (
    <div className="container workspace">
      <div className="workspace-title">
        <div>
          <div className="eyebrow">YOUR NEXT CHAPTER</div>
          <h1>Your career workspace.</h1>
        </div>
        <div className="row-actions">
          <Link href="/employers" className="text-link">
            Employer teams →
          </Link>
          <Button
            variant="secondary"
            onClick={async () => {
              await authClient.signOut();
              router.push('/');
            }}
          >
            Sign out
          </Button>
        </div>
      </div>
      <div className="workspace-tabs" role="tablist" aria-label="Workspace sections">
        {[
          'Overview',
          'Saved jobs',
          'Applications',
          'Alerts & searches',
          'Profile',
          'Documents',
          'Privacy',
        ].map((t) => (
          <button key={t} role="tab" aria-selected={t === tab} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </div>
      {message && (
        <div style={{ marginBottom: 20 }}>
          <Notice error={error}>{message}</Notice>
        </div>
      )}
      {tab === 'Overview' && (
        <>
          <div className="stats">
            {[
              { n: data.saved.length, l: 'Saved jobs' },
              { n: data.applications.length, l: 'Tracked applications' },
              { n: data.alerts.filter((a) => a.enabled).length, l: 'Active alerts' },
              { n: data.notifications.filter((n) => !n.readAt).length, l: 'Unread updates' },
            ].map((x) => (
              <div className="stat" key={x.l}>
                <strong>{x.n}</strong>
                <span>{x.l}</span>
              </div>
            ))}
          </div>
          <section className="panel">
            <h2>Recent updates</h2>
            {data.notifications.some((n) => !n.readAt) && (
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() =>
                  run(() => api('notifications/read-all', 'POST'), 'Updates marked as read.')
                }
              >
                Mark all as read
              </Button>
            )}
            {data.notifications.length ? (
              data.notifications.map((n) => (
                <div className="workspace-row" key={n.id}>
                  <div>
                    <h3>{n.title}</h3>
                    <p>{n.body}</p>
                    <span className="pill">{n.readAt ? 'Read' : 'Unread'}</span>
                  </div>
                  <div className="row-actions">
                    {n.href && <Link href={n.href}>View →</Link>}
                    <Button
                      variant="ghost"
                      disabled={busy}
                      onClick={() =>
                        run(
                          () => api('notifications/' + n.id, 'PATCH', { read: !n.readAt }),
                          n.readAt ? 'Marked as unread.' : 'Marked as read.',
                        )
                      }
                    >
                      {n.readAt ? 'Mark unread' : 'Mark read'}
                    </Button>
                  </div>
                </div>
              ))
            ) : (
              <Empty title="Your next update starts here">
                Save a job or create an alert to start shaping your search.
              </Empty>
            )}
          </section>
          <Recommendations />
        </>
      )}
      {tab === 'Saved jobs' && (
        <section className="panel">
          <h2>Keep your possibilities close.</h2>
          {data.saved.length ? (
            data.saved.map(({ job, company }) => (
              <div className="workspace-row" key={job.id}>
                <div>
                  <h3>
                    <Link href={jobPath(job)}>{job.title}</Link>
                  </h3>
                  <p>
                    {company} · {job.status}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() =>
                    run(
                      () => api('saved-jobs', 'POST', { jobId: job.id, save: false }),
                      'Job removed from saved list.',
                    )
                  }
                >
                  Remove
                </Button>
              </div>
            ))
          ) : (
            <Empty title="A space for your shortlist">
              Browse jobs and select Save job on an opportunity you want to revisit.
            </Empty>
          )}
        </section>
      )}
      {tab === 'Applications' && (
        <section className="panel">
          <h2>Know where things stand.</h2>
          <p>
            External status is based on your own tracking. Opening an external page does not confirm
            submission.
          </p>
          {data.applications.length ? (
            data.applications.map(({ application: a, title }) => (
              <div className="workspace-row" key={a.id}>
                <div>
                  <h3>{title}</h3>
                  <span className="pill">{a.status.replaceAll('_', ' ')}</span>
                  <p>
                    {a.kind === 'external'
                      ? 'Self-tracked external activity'
                      : 'Native application'}{' '}
                    · {new Date(a.createdAt).toLocaleDateString()}
                  </p>
                </div>
                <div className="row-actions">
                  {a.kind === 'external' && a.status !== 'applied_external' && (
                    <Button
                      variant="secondary"
                      disabled={busy}
                      onClick={() =>
                        run(
                          () =>
                            api('external-activity', 'POST', {
                              jobId: a.jobId,
                              status: 'applied_external',
                            }),
                          'Marked as submitted by you.',
                        )
                      }
                    >
                      I submitted externally
                    </Button>
                  )}
                  {a.kind === 'native' && a.status !== 'withdrawn' && (
                    <Button
                      variant="ghost"
                      disabled={busy}
                      onClick={() =>
                        run(
                          () => api('applications/' + a.id, 'PATCH', { status: 'withdrawn' }),
                          'Application withdrawn.',
                        )
                      }
                    >
                      Withdraw
                    </Button>
                  )}
                </div>
              </div>
            ))
          ) : (
            <Empty title="Your applications will appear here">
              A successful native submission appears automatically. External applications are
              self-tracked.
            </Empty>
          )}
        </section>
      )}
      {tab === 'Alerts & searches' && (
        <div className="workspace-grid">
          <section className="panel">
            <h2>Stay in the loop.</h2>
            {!data.preferences.emailAlertsEnabled && (
              <Notice>
                Email job alerts are off. Matches still appear in your workspace. Change this in
                Privacy.
              </Notice>
            )}
            {data.alerts.map((a) => (
              <div key={a.id}>
                <div className="workspace-row" key={a.id}>
                  <div>
                    <h3>{a.name}</h3>
                    <p>
                      {a.frequency} · {a.channel} · {a.enabled ? 'Enabled' : 'Paused'}
                    </p>
                    <p>{searchSummary(a.filters)}</p>
                  </div>
                  <div className="row-actions">
                    <Button
                      variant="ghost"
                      disabled={busy}
                      onClick={() => {
                        setResumingAlert(null);
                        setEditingAlert(a.id);
                      }}
                    >
                      Edit alert
                    </Button>
                    <Button
                      variant="ghost"
                      disabled={busy}
                      onClick={() => {
                        if (a.enabled) {
                          void run(
                            () => api('alerts/' + a.id, 'PATCH', { enabled: false }),
                            'Alert paused.',
                          );
                        } else {
                          setResumingAlert(a.id);
                          setEditingAlert(a.id);
                        }
                      }}
                    >
                      {a.enabled ? 'Pause' : 'Resume'}
                    </Button>
                    <Button
                      variant="ghost"
                      disabled={busy}
                      onClick={() => run(() => api('alerts/' + a.id, 'DELETE'), 'Alert deleted.')}
                    >
                      Delete
                    </Button>
                  </div>
                </div>
                {editingAlert === a.id && (
                  <SearchPreferenceEditor
                    key={'alert-' + a.id}
                    name={a.name}
                    filters={a.filters}
                    alert={{ ...a, enabled: a.enabled || resumingAlert === a.id }}
                    busy={busy}
                    save={(values) =>
                      run(
                        () => api('alerts/' + a.id, 'PATCH', values),
                        'Alert settings saved.',
                        () => setEditingAlert(null),
                      )
                    }
                    cancel={() => setEditingAlert(null)}
                  />
                )}
              </div>
            ))}
            <h3 style={{ marginTop: 25 }}>Create a matching alert</h3>
            <SearchAlert onCreated={load} />
          </section>
          <section className="panel">
            <h2>Saved searches</h2>
            {data.searches.map((s) => (
              <div key={s.id}>
                <div className="workspace-row" key={s.id}>
                  <Link href={searchHref(s.filters)}>{s.name} →</Link>
                  <div className="row-actions">
                    <Button variant="ghost" disabled={busy} onClick={() => setEditingSearch(s.id)}>
                      Edit search
                    </Button>
                    <Button
                      variant="ghost"
                      disabled={busy}
                      onClick={() => run(() => api('saved-searches/' + s.id, 'DELETE'))}
                    >
                      Delete
                    </Button>
                  </div>
                </div>
                {editingSearch === s.id && (
                  <SearchPreferenceEditor
                    key={'search-' + s.id}
                    name={s.name}
                    filters={s.filters}
                    busy={busy}
                    save={(values) =>
                      run(
                        () => api('saved-searches/' + s.id, 'PATCH', values),
                        'Search settings saved.',
                        () => setEditingSearch(null),
                      )
                    }
                    cancel={() => setEditingSearch(null)}
                  />
                )}
              </div>
            ))}
            {!data.searches.length && (
              <p>Save a search from the results page to revisit it here.</p>
            )}
            <h2 style={{ marginTop: 35 }}>Recent searches</h2>
            <p>
              History is optional. Manage it in Privacy. Up to 50 searches are retained for 90 days.
            </p>
            {data.history.length ? (
              <>
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() =>
                    run(() => api('search-history', 'DELETE'), 'Search history cleared.')
                  }
                >
                  Clear search history
                </Button>
                {data.history.map((item) => (
                  <div className="workspace-row" key={item.id}>
                    <div>
                      <Link href={searchHref(item.filters)}>{searchSummary(item.filters)} →</Link>
                      <p>{new Date(item.lastUsedAt).toLocaleDateString()}</p>
                    </div>
                    <Button
                      variant="ghost"
                      disabled={busy}
                      onClick={() =>
                        run(
                          () => api('search-history/' + item.id, 'DELETE'),
                          'Search removed from history.',
                        )
                      }
                    >
                      Remove search
                    </Button>
                  </div>
                ))}
              </>
            ) : (
              <p>
                {data.preferences.searchHistoryEnabled
                  ? 'Your next filtered search will appear here.'
                  : 'Search history is off.'}
              </p>
            )}
          </section>
        </div>
      )}
      {tab === 'Profile' && (
        <ProfileEditor
          profile={data.profile}
          busy={busy}
          save={(d) => run(() => api('profile', 'PUT', d), 'Profile updated.')}
        />
      )}
      {tab === 'Documents' && (
        <section className="panel">
          <h2>Your documents, kept private.</h2>
          <p>
            PDF only, up to 5 MB. Uploads are quarantined until a security reviewer records a clean
            scan. Quarantined files cannot be applied with or downloaded.
          </p>
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              const form = e.currentTarget;
              const file = (form.elements.namedItem('resume') as HTMLInputElement).files?.[0];
              if (!file) return;
              void run(async () => {
                const r = await fetch('/api/uploads', {
                  method: 'POST',
                  headers: { 'Content-Type': file.type, 'X-File-Name': file.name },
                  body: file,
                });
                const result = await r.json();
                if (!r.ok) throw new Error(result.error);
                form.reset();
              }, 'Uploaded. Your PDF is quarantined pending security review.');
            }}
          >
            <label>
              Upload résumé
              <input type="file" name="resume" accept="application/pdf" required />
            </label>
            <Button disabled={busy}>Upload PDF</Button>
          </form>
          {data.resumes.map((r) => (
            <div className="workspace-row" key={r.id}>
              <div>
                <h3>{r.filename}</h3>
                <p>{r.status}</p>
                <code className="inline-code">{r.id}</code>
              </div>
              <div className="row-actions">
                {r.status === 'clean' && (
                  <Button
                    variant="secondary"
                    onClick={() =>
                      run(async () => {
                        const d = await api('resumes/' + r.id);
                        window.location.assign(d.url);
                      }, 'Secure document link opened.')
                    }
                  >
                    Download
                  </Button>
                )}
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() => run(() => api('resumes/' + r.id, 'DELETE'), 'Document deleted.')}
                >
                  Remove
                </Button>
              </div>
            </div>
          ))}
        </section>
      )}
      {tab === 'Privacy' && (
        <section className="panel">
          <h2>Your information, your control.</h2>
          <form
            className="stack"
            key={JSON.stringify(data.preferences)}
            onSubmit={(e) => {
              e.preventDefault();
              const fields = new FormData(e.currentTarget);
              void run(
                () =>
                  api('preferences', 'PUT', {
                    emailAlertsEnabled: fields.get('emailAlertsEnabled') === 'on',
                    searchHistoryEnabled: fields.get('searchHistoryEnabled') === 'on',
                  }),
                'Preferences saved.',
              );
            }}
          >
            <label className="checkbox">
              <input
                type="checkbox"
                name="emailAlertsEnabled"
                defaultChecked={data.preferences.emailAlertsEnabled}
              />
              Allow email job alerts I have subscribed to.
            </label>
            <small>
              Turning this off cancels queued job-alert emails. In-app updates and essential account
              messages remain available. An email already being delivered cannot be recalled.
            </small>
            <label className="checkbox">
              <input
                type="checkbox"
                name="searchHistoryEnabled"
                defaultChecked={data.preferences.searchHistoryEnabled}
              />
              Remember my recent job searches.
            </label>
            <small>
              Off by default. Turning history off deletes existing history. Saved searches remain
              available separately.
            </small>
            <Button disabled={busy}>Save privacy preferences</Button>
          </form>
          <h3 style={{ marginTop: 35 }}>Export your information</h3>
          <p>
            Export your profile, saved jobs, applications, alerts and visible activity. Employer
            internal notes are not included.
          </p>
          <a
            className="button button-secondary"
            download="careeratlas-data.json"
            href="/api/platform/export"
          >
            Export my data (JSON)
          </a>
          <h3 style={{ marginTop: 35 }}>Delete your account data</h3>
          <p>
            This removes profile, credentials, documents and candidate records. Financial and
            security audit records subject to retention are anonymized where possible. Organization
            owners must transfer ownership first.
          </p>
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                await api('account/delete', 'POST', {
                  confirmation: new FormData(e.currentTarget).get('confirmation'),
                });
                router.push('/');
              });
            }}
          >
            <label>
              Type DELETE to confirm
              <input name="confirmation" required pattern="DELETE" />
            </label>
            <Button variant="danger" disabled={busy}>
              Delete my account data
            </Button>
          </form>
        </section>
      )}
    </div>
  );
}
function SearchAlert({ onCreated }: { onCreated: () => Promise<void> }) {
  const [q, setQ] = useState('');
  const [country, setCountry] = useState('');
  return (
    <div className="stack">
      <label>
        Role or skills
        <input value={q} onChange={(e) => setQ(e.target.value)} />
      </label>
      <label>
        Country code (optional)
        <input
          value={country}
          onChange={(e) => setCountry(e.target.value.toUpperCase())}
          maxLength={2}
        />
      </label>
      <AlertForm filters={{ q, ...(country ? { country } : {}) }} onCreated={onCreated} />
    </div>
  );
}
function Recommendations() {
  const [result, setResult] = useState<{
    jobs: { id: string; slug: string; title: string }[];
    explanation: string;
  } | null>(null);
  const [error, setError] = useState('');
  return (
    <section className="panel">
      <h2>Explore your fit.</h2>
      <p>Recommendations use the skills you choose to share, without AI scoring.</p>
      <Button
        variant="secondary"
        onClick={async () => {
          try {
            setResult(await api('recommendations'));
            setError('');
          } catch (e) {
            setError((e as Error).message);
          }
        }}
      >
        Find relevant roles
      </Button>
      {result && (
        <>
          <p style={{ marginTop: 15 }}>{result.explanation}</p>
          {result.jobs.map((j) => (
            <div className="workspace-row" key={j.id}>
              <Link href={jobPath(j)}>{j.title} →</Link>
            </div>
          ))}
        </>
      )}
      {error && <Notice error>{error}</Notice>}
    </section>
  );
}

function ProfileEditor({
  profile,
  busy,
  save,
}: {
  profile: Serialized<Data>['profile'];
  busy: boolean;
  save: (data: unknown) => Promise<void>;
}) {
  const [experience, setExperience] = useState(
    (profile?.experience ?? []) as { company: string; role: string; description: string }[],
  );
  const [education, setEducation] = useState(
    (profile?.education ?? []) as { institution: string; qualification: string }[],
  );
  return (
    <section className="panel">
      <h2>Your experience, in your own words.</h2>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          const d = new FormData(e.currentTarget);
          void save({
            headline: d.get('headline'),
            country: d.get('country') || null,
            skills: String(d.get('skills'))
              .split(',')
              .map((v) => v.trim())
              .filter(Boolean),
            experience,
            education,
            emailConsent: d.get('emailConsent') === 'on',
            aiConsent: false,
          });
        }}
      >
        <label>
          Professional headline
          <input name="headline" defaultValue={profile?.headline} maxLength={200} />
        </label>
        <div className="form-grid">
          <label>
            Country code
            <input
              name="country"
              defaultValue={profile?.country ?? ''}
              pattern="[A-Z]{2}"
              maxLength={2}
            />
          </label>
          <label>
            Skills, comma separated
            <input name="skills" defaultValue={profile?.skills.join(', ')} />
          </label>
        </div>
        <h3>Experience</h3>
        {experience.map((item, i) => (
          <fieldset className="panel" key={i}>
            <legend>Experience {i + 1}</legend>
            <div className="form-grid">
              <label>
                Company
                <input
                  value={item.company}
                  maxLength={200}
                  required
                  onChange={(e) =>
                    setExperience(
                      experience.map((x, j) => (j === i ? { ...x, company: e.target.value } : x)),
                    )
                  }
                />
              </label>
              <label>
                Role
                <input
                  value={item.role}
                  maxLength={200}
                  required
                  onChange={(e) =>
                    setExperience(
                      experience.map((x, j) => (j === i ? { ...x, role: e.target.value } : x)),
                    )
                  }
                />
              </label>
              <label className="full-width">
                Your actual contribution
                <textarea
                  value={item.description}
                  maxLength={3000}
                  onChange={(e) =>
                    setExperience(
                      experience.map((x, j) =>
                        j === i ? { ...x, description: e.target.value } : x,
                      ),
                    )
                  }
                />
              </label>
            </div>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setExperience(experience.filter((_, j) => j !== i))}
            >
              Remove experience {i + 1}
            </Button>
          </fieldset>
        ))}
        <Button
          type="button"
          variant="secondary"
          disabled={experience.length >= 30}
          onClick={() => setExperience([...experience, { company: '', role: '', description: '' }])}
        >
          Add experience
        </Button>
        <h3>Education</h3>
        {education.map((item, i) => (
          <fieldset className="panel" key={i}>
            <legend>Education {i + 1}</legend>
            <div className="form-grid">
              <label>
                Institution
                <input
                  value={item.institution}
                  required
                  maxLength={200}
                  onChange={(e) =>
                    setEducation(
                      education.map((x, j) =>
                        j === i ? { ...x, institution: e.target.value } : x,
                      ),
                    )
                  }
                />
              </label>
              <label>
                Qualification
                <input
                  value={item.qualification}
                  maxLength={200}
                  onChange={(e) =>
                    setEducation(
                      education.map((x, j) =>
                        j === i ? { ...x, qualification: e.target.value } : x,
                      ),
                    )
                  }
                />
              </label>
            </div>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setEducation(education.filter((_, j) => j !== i))}
            >
              Remove education {i + 1}
            </Button>
          </fieldset>
        ))}
        <Button
          type="button"
          variant="secondary"
          disabled={education.length >= 20}
          onClick={() => setEducation([...education, { institution: '', qualification: '' }])}
        >
          Add education
        </Button>
        <label className="checkbox">
          <input name="emailConsent" type="checkbox" defaultChecked={profile?.emailConsent} />I
          consent to optional account communications. Manage job alerts separately.
        </label>
        <Button disabled={busy}>Save profile</Button>
      </form>
      <p style={{ marginTop: 20, fontSize: 11 }}>
        AI résumé processing is disabled. Your documents are not sent to an AI provider.
      </p>
    </section>
  );
}

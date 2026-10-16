'use client';
import type { applications, employers, jobs } from '@/db/schema';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { api } from './actions';
import { MetricsPanel } from './metrics-panel';
import { Button, Empty, Notice } from './ui';
type Company = typeof employers.$inferSelect;
type Job = typeof jobs.$inferSelect;
type Org = { employer: Company; role: string };
type Applicant = {
  application: typeof applications.$inferSelect;
  title: string;
  candidate: { id: string; name: string; email: string };
};
const stages = ['new', 'reviewing', 'shortlisted', 'interview', 'offer', 'hired', 'rejected'];
export function EmployerWorkspace() {
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [org, setOrg] = useState('');
  const [role, setRole] = useState('');
  const [list, setList] = useState<Job[]>([]);
  const [apps, setApps] = useState<Applicant[]>([]);
  const [tab, setTab] = useState('Vacancies');
  const [editing, setEditing] = useState<Job | undefined>();
  const [editor, setEditor] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState(false);
  const [initialError, setInitialError] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  async function loadOrganizations() {
    try {
      const data = await api('employers');
      setOrgs(data);
      setLoaded(true);
      if (data.length && !org) {
        setOrg(data[0].employer.id);
        setRole(data[0].role);
      }
      setInitialError('');
    } catch (e) {
      setInitialError((e as Error).message);
    }
  }
  async function loadCompany(id: string) {
    if (!id) return;
    try {
      const [j, a] = await Promise.all([
        api(`employers/${id}/jobs`),
        api(`employers/${id}/applications`),
      ]);
      setList(j);
      setApps(a);
    } catch (e) {
      setError(true);
      setMessage((e as Error).message);
    }
  }
  useEffect(() => {
    void Promise.resolve().then(loadOrganizations);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    void Promise.resolve().then(() => loadCompany(org));
  }, [org]);
  async function run(fn: () => Promise<unknown>, success = 'Saved.') {
    setBusy(true);
    setError(false);
    setMessage('');
    try {
      await fn();
      await loadCompany(org);
      setMessage(success);
    } catch (e) {
      setError(true);
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const company = orgs.find((x) => x.employer.id === org)?.employer;
  if (initialError)
    return (
      <div className="container page-container">
        <Notice error>{initialError}</Notice>
        <h1 style={{ marginTop: 30 }}>Great hiring starts with a clear opportunity.</h1>
        <p>
          Create a verified account, set up your organization and submit your first job for review.
        </p>
        <Link href="/auth" className="button button-primary">
          Create account or sign in
        </Link>
      </div>
    );
  if (!loaded)
    return (
      <div className="container page-container" role="status">
        Loading employer workspace…
      </div>
    );
  return (
    <div className="container workspace">
      <div className="workspace-title">
        <div>
          <div className="eyebrow">BUILD YOUR NEXT TEAM</div>
          <h1>Employer workspace.</h1>
        </div>
        <Link href="/dashboard" className="text-link">
          Candidate workspace →
        </Link>
      </div>
      {message && (
        <div style={{ marginBottom: 20 }}>
          <Notice error={error}>{message}</Notice>
        </div>
      )}
      {orgs.length > 0 && (
        <div className="row-actions" style={{ marginBottom: 25 }}>
          <label style={{ flex: 1 }}>
            Organization
            <select
              value={org}
              onChange={(e) => {
                setOrg(e.target.value);
                setRole(orgs.find((o) => o.employer.id === e.target.value)?.role ?? '');
                setEditor(false);
              }}
            >
              {orgs.map((o) => (
                <option key={o.employer.id} value={o.employer.id}>
                  {o.employer.name} · {o.employer.verificationStatus}
                </option>
              ))}
            </select>
          </label>
          <span className="pill">{role}</span>
        </div>
      )}
      {!orgs.length ? (
        <section className="panel">
          <h2>Set up your organization.</h2>
          <p>
            Organization ownership and job publication are verified by an administrator before your
            listings go live.
          </p>
          <CompanyForm
            busy={busy}
            onSubmit={async (d) => {
              await run(async () => {
                const result = await api('employers', 'POST', d);
                setOrg(result.id);
                setRole('owner');
                await loadOrganizations();
              }, 'Organization created. Verification is pending.');
            }}
          />
        </section>
      ) : (
        <>
          <div className="workspace-tabs" role="tablist" aria-label="Employer sections">
            {['Vacancies', 'Applicants', 'Company profile', 'Team', 'Billing', 'Analytics'].map(
              (t) => (
                <button role="tab" aria-selected={tab === t} key={t} onClick={() => setTab(t)}>
                  {t}
                </button>
              ),
            )}
          </div>
          {tab === 'Vacancies' && (
            <>
              <div className="section-row">
                <div>
                  <h2>Your opportunities</h2>
                  <p>Draft → review → publication. Edits to active listings return to review.</p>
                </div>
                <Button
                  disabled={busy}
                  onClick={() => {
                    setEditing(undefined);
                    setEditor(true);
                  }}
                >
                  Create a vacancy ↗
                </Button>
              </div>
              {editor && (
                <section className="panel">
                  <div className="section-row">
                    <h2>{editing ? 'Edit vacancy' : 'Draft a clear opportunity'}</h2>
                    <Button variant="ghost" onClick={() => setEditor(false)}>
                      Cancel
                    </Button>
                  </div>
                  <JobEditor
                    key={editing?.id ?? 'new'}
                    job={editing}
                    busy={busy}
                    onSubmit={async (d) => {
                      await run(async () => {
                        await api(
                          `employers/${org}/jobs${editing?.id ? '/' + editing.id : ''}`,
                          editing?.id ? 'PUT' : 'POST',
                          editing?.id ? { job: d, expectedVersion: editing.version } : d,
                        );
                        setEditor(false);
                      }, 'Draft saved. Submit it for moderation when ready.');
                    }}
                  />
                </section>
              )}
              {!list.length && !editor && (
                <Empty title="Your next hire starts here">
                  Create a vacancy, preview the description and submit it for review.
                </Empty>
              )}
              {list.map((j) => (
                <div className="panel" key={j.id}>
                  <div className="workspace-row">
                    <div>
                      <h3>{j.title}</h3>
                      <p>
                        {j.locationLabel} · <span className="pill">{j.status}</span>
                      </p>
                      <small>
                        Version {j.version} · {j.applicationMethod} applications
                      </small>
                    </div>
                    <div className="row-actions">
                      <Button
                        variant="secondary"
                        disabled={busy}
                        onClick={() => {
                          setEditing(j);
                          setEditor(true);
                        }}
                      >
                        Edit / preview
                      </Button>
                      {['draft', 'rejected', 'paused', 'closed', 'expired'].includes(j.status) && (
                        <Button
                          disabled={busy}
                          onClick={() =>
                            run(
                              () => api(`jobs/${j.id}/transition`, 'POST', { action: 'submit' }),
                              'Submitted for moderation.',
                            )
                          }
                        >
                          Submit for review
                        </Button>
                      )}
                      {j.status === 'active' && (
                        <Button
                          variant="secondary"
                          disabled={busy}
                          onClick={() =>
                            run(
                              () => api(`jobs/${j.id}/transition`, 'POST', { action: 'pause' }),
                              'Applications paused.',
                            )
                          }
                        >
                          Pause
                        </Button>
                      )}
                      {['active', 'pending', 'paused'].includes(j.status) && (
                        <Button
                          variant="ghost"
                          disabled={busy}
                          onClick={() =>
                            run(
                              () => api(`jobs/${j.id}/transition`, 'POST', { action: 'close' }),
                              'Position closed.',
                            )
                          }
                        >
                          Close
                        </Button>
                      )}
                      {j.status === 'active' && (
                        <Button
                          variant="ghost"
                          disabled={busy}
                          onClick={() =>
                            run(
                              () =>
                                api(`employers/${org}/feature`, 'POST', { jobId: j.id, days: 7 }),
                              'Labeled sponsored placement activated for the permitted paid period.',
                            )
                          }
                        >
                          Feature (paid plan)
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        disabled={busy}
                        onClick={() => {
                          setEditing({
                            ...j,
                            id: '',
                            version: 0,
                            title: j.title + ' (new opening)',
                          });
                          setEditor(true);
                        }}
                      >
                        Use as template
                      </Button>
                    </div>
                  </div>
                  <details>
                    <summary>Preview description</summary>
                    <div
                      className="prose"
                      dangerouslySetInnerHTML={{ __html: j.descriptionHtml }}
                    />
                  </details>
                </div>
              ))}
            </>
          )}
          {tab === 'Applicants' && (
            <section className="panel">
              <h2>Applications you can act on.</h2>
              <p>
                Native applications only. Notes are internal to authorized recruiters. Contact
                details must be used only for the relevant recruitment.
              </p>
              {apps.length ? (
                apps.map((a) => (
                  <ApplicantRow key={a.application.id} app={a} busy={busy} run={run} />
                ))
              ) : (
                <Empty title="Your applicants will appear here">
                  Publish a native-application vacancy to receive submissions in this workspace.
                </Empty>
              )}
              <Button
                variant="secondary"
                style={{ marginTop: 20 }}
                onClick={() => {
                  const csv = [
                    'Name,Email,Job,Status',
                    ...apps.map((a) =>
                      [a.candidate.name, a.candidate.email, a.title, a.application.status]
                        .map(
                          (v) => '"' + v.replace(/^[=+@\-\t\r]/, "'").replaceAll('"', '""') + '"',
                        )
                        .join(','),
                    ),
                  ].join('\r\n');
                  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = 'authorized-applicants.csv';
                  a.click();
                  URL.revokeObjectURL(url);
                }}
              >
                Export authorized applicants
              </Button>
            </section>
          )}
          {tab === 'Company profile' && company && (
            <section className="panel">
              <h2>Your company, clearly represented.</h2>
              <p>Changing your name or official website requires re-verification.</p>
              <CompanyForm
                busy={busy}
                company={company}
                onSubmit={async (d) => {
                  await run(async () => {
                    await api('employers/' + org, 'PUT', d);
                    await loadOrganizations();
                  }, 'Company profile updated.');
                }}
              />
            </section>
          )}
          {tab === 'Analytics' && <MetricsPanel employerId={org} />}
          {tab === 'Team' && <Team employerId={org} role={role} />}
          {tab === 'Billing' && <Billing employerId={org} />}
        </>
      )}
    </div>
  );
}
function CompanyForm({
  company,
  busy,
  onSubmit,
}: {
  company?: Company;
  busy: boolean;
  onSubmit: (data: unknown) => Promise<void>;
}) {
  return (
    <form
      className="form-grid"
      onSubmit={(e) => {
        e.preventDefault();
        const d = new FormData(e.currentTarget);
        void onSubmit(Object.fromEntries(d));
      }}
    >
      <label>
        Company name
        <input name="name" defaultValue={company?.name} minLength={2} maxLength={160} required />
      </label>
      <label>
        Official website
        <input
          name="website"
          type="url"
          defaultValue={company?.website}
          required
          placeholder="https://company.example"
        />
      </label>
      <label>
        Industry
        <input name="industry" defaultValue={company?.industry ?? ''} />
      </label>
      <label>
        Headquarters
        <input name="headquarters" defaultValue={company?.headquarters ?? ''} />
      </label>
      <label>
        Company size (optional)
        <input name="size" defaultValue={company?.size ?? ''} />
      </label>
      <label className="full-width">
        Company description
        <textarea
          name="description"
          defaultValue={company?.description}
          maxLength={10000}
          rows={5}
        />
      </label>
      <Button disabled={busy}>Save organization</Button>
    </form>
  );
}
function JobEditor({
  job,
  busy,
  onSubmit,
}: {
  job?: Job;
  busy: boolean;
  onSubmit: (data: unknown) => Promise<void>;
}) {
  const [preview, setPreview] = useState('');
  const date = (v: Date | null | undefined) => (v ? new Date(v).toISOString().slice(0, 16) : '');
  return (
    <form
      className="form-grid"
      onSubmit={(e) => {
        e.preventDefault();
        const d = new FormData(e.currentTarget);
        const value = (k: string) => String(d.get(k) ?? '');
        const optional = (k: string) => value(k) || undefined;
        const number = (k: string) => (value(k) === '' ? null : Number(value(k)));
        void onSubmit({
          title: value('title'),
          descriptionHtml: value('descriptionHtml'),
          locationLabel: value('locationLabel'),
          country: value('country') || null,
          region: optional('region'),
          city: optional('city'),
          workplace: value('workplace'),
          remoteCountries: value('remoteCountries')
            .split(',')
            .map((v) => v.trim().toUpperCase())
            .filter(Boolean),
          employmentType: value('employmentType') || null,
          seniority: optional('seniority'),
          category: optional('category'),
          skills: value('skills')
            .split(',')
            .map((v) => v.trim())
            .filter(Boolean),
          education: optional('education'),
          experienceMin: number('experienceMin'),
          visaSponsorship: value('visa') === '' ? null : value('visa') === 'true',
          salaryMin: number('salaryMin'),
          salaryMax: number('salaryMax'),
          currency: value('currency') || null,
          salaryPeriod: value('salaryPeriod') || null,
          applicationMethod: value('applicationMethod'),
          resumeRequired: d.get('resumeRequired') === 'on',
          applyUrl: value('applyUrl') || null,
          originalPostedAt: value('originalPostedAt')
            ? new Date(value('originalPostedAt') + 'Z').toISOString()
            : null,
          expiresAt: value('expiresAt') ? new Date(value('expiresAt') + 'Z').toISOString() : null,
        });
      }}
    >
      <label className="full-width">
        Actual job title
        <input name="title" defaultValue={job?.title} minLength={3} maxLength={180} required />
      </label>
      <label className="full-width">
        Description, responsibilities, qualifications & benefits (HTML supported)
        <textarea
          name="descriptionHtml"
          defaultValue={job?.descriptionHtml}
          minLength={80}
          maxLength={100000}
          rows={12}
          required
          onChange={(e) => setPreview(e.target.value)}
        />
      </label>
      {preview && (
        <div className="preview full-width">
          <strong>Text preview (formatting is sanitized on save)</strong>
          <p style={{ whiteSpace: 'pre-wrap' }}>{preview.replace(/<[^>]*>/g, '')}</p>
        </div>
      )}
      <label>
        Location label
        <input name="locationLabel" defaultValue={job?.locationLabel} required />
      </label>
      <label>
        Workplace
        <select name="workplace" defaultValue={job?.workplace ?? 'unknown'}>
          {['unknown', 'remote', 'hybrid', 'onsite'].map((v) => (
            <option key={v}>{v}</option>
          ))}
        </select>
      </label>
      <label>
        Country code
        <input name="country" pattern="[A-Z]{2}" maxLength={2} defaultValue={job?.country ?? ''} />
      </label>
      <label>
        City
        <input name="city" defaultValue={job?.city ?? ''} />
      </label>
      <label>
        State or region
        <input name="region" defaultValue={job?.region ?? ''} />
      </label>
      <label>
        Remote applicant country codes (comma separated)
        <input name="remoteCountries" defaultValue={job?.remoteCountries.join(', ')} />
      </label>
      <label>
        Employment type
        <select name="employmentType" defaultValue={job?.employmentType ?? ''}>
          <option value="">Not specified</option>
          {[
            'FULL_TIME',
            'PART_TIME',
            'CONTRACTOR',
            'TEMPORARY',
            'INTERN',
            'VOLUNTEER',
            'PER_DIEM',
            'OTHER',
          ].map((v) => (
            <option key={v}>{v}</option>
          ))}
        </select>
      </label>
      <label>
        Seniority
        <input name="seniority" defaultValue={job?.seniority ?? ''} />
      </label>
      <label>
        Minimum experience, years
        <input
          name="experienceMin"
          type="number"
          min={0}
          max={60}
          defaultValue={job?.experienceMin ?? ''}
        />
      </label>
      <label>
        Education (if known)
        <input name="education" defaultValue={job?.education ?? ''} />
      </label>
      <label>
        Category
        <input name="category" defaultValue={job?.category ?? ''} />
      </label>
      <label>
        Skills, comma separated
        <input name="skills" defaultValue={job?.skills.join(', ')} />
      </label>
      <label>
        Salary minimum
        <input name="salaryMin" type="number" min={0} defaultValue={job?.salaryMin ?? ''} />
      </label>
      <label>
        Salary maximum
        <input name="salaryMax" type="number" min={0} defaultValue={job?.salaryMax ?? ''} />
      </label>
      <label>
        Currency code
        <input name="currency" pattern="[A-Z]{3}" defaultValue={job?.currency ?? ''} />
      </label>
      <label>
        Salary period
        <select name="salaryPeriod" defaultValue={job?.salaryPeriod ?? ''}>
          <option value="">Not disclosed</option>
          {['HOUR', 'DAY', 'WEEK', 'MONTH', 'YEAR'].map((v) => (
            <option key={v}>{v}</option>
          ))}
        </select>
      </label>
      <label>
        Visa sponsorship
        <select
          name="visa"
          defaultValue={job?.visaSponsorship == null ? '' : String(job.visaSponsorship)}
        >
          <option value="">Not disclosed / unknown</option>
          <option value="true">Explicitly offered</option>
          <option value="false">Not offered</option>
        </select>
      </label>
      <label>
        Applications
        <select name="applicationMethod" defaultValue={job?.applicationMethod ?? 'external'}>
          <option value="external">Employer’s external site</option>
          <option value="native">Native application</option>
        </select>
      </label>
      <label className="checkbox full-width">
        <input type="checkbox" name="resumeRequired" defaultChecked={job?.resumeRequired} />
        Require a clean résumé for native applications
      </label>
      <label className="full-width">
        Authorized external application URL
        <input type="url" name="applyUrl" defaultValue={job?.applyUrl ?? ''} />
      </label>
      <label>
        Original posting date (UTC, optional)
        <input
          type="datetime-local"
          name="originalPostedAt"
          defaultValue={date(job?.originalPostedAt)}
        />
      </label>
      <label>
        Application deadline (UTC, optional)
        <input type="datetime-local" name="expiresAt" defaultValue={date(job?.expiresAt)} />
      </label>
      <p className="full-width" style={{ fontSize: 12 }}>
        Publish only facts supported by the employer. Leave undisclosed compensation, sponsorship
        and experience unknown.
      </p>
      <Button disabled={busy}>Save draft</Button>
    </form>
  );
}
function ApplicantRow({
  app: a,
  busy,
  run,
}: {
  app: Applicant;
  busy: boolean;
  run: (fn: () => Promise<unknown>, success?: string) => Promise<void>;
}) {
  const [events, setEvents] = useState<{ id: string; status: string; note: string | null }[]>([]);
  const [message, setMessage] = useState('');
  return (
    <div className="workspace-row">
      <div style={{ width: '100%' }}>
        <h3>
          {a.candidate.name} · {a.title}
        </h3>
        <p>
          {a.candidate.email} · {a.application.status}
        </p>
        <p style={{ whiteSpace: 'pre-wrap' }}>{a.application.coverLetter}</p>
        {a.application.resumeId && (
          <Button
            variant="secondary"
            onClick={() =>
              run(async () => {
                const r = await api('resumes/' + a.application.resumeId);
                window.location.assign(r.url);
              }, 'Secure résumé link opened.')
            }
          >
            Download résumé
          </Button>
        )}
        <form
          className="form-grid"
          style={{ marginTop: 15 }}
          onSubmit={(e) => {
            e.preventDefault();
            const d = new FormData(e.currentTarget);
            void run(
              () =>
                api('applications/' + a.application.id, 'PATCH', {
                  status: d.get('status'),
                  note: d.get('note') || undefined,
                }),
              'Application status and internal note saved.',
            );
          }}
        >
          <label>
            Recruitment stage
            <select name="status" defaultValue={a.application.status}>
              {stages.map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </label>
          <label>
            Internal note
            <input name="note" maxLength={4000} />
          </label>
          <Button variant="secondary" disabled={busy}>
            Update application
          </Button>
        </form>
        <button
          className="text-button"
          onClick={async () => {
            try {
              setEvents(await api('applications/' + a.application.id + '/events'));
            } catch (e) {
              setMessage((e as Error).message);
            }
          }}
        >
          Show activity history
        </button>
        {events.map((e) => (
          <p key={e.id}>
            {e.status}
            {e.note ? ' · ' + e.note : ''}
          </p>
        ))}
        {message && <Notice error>{message}</Notice>}
      </div>
    </div>
  );
}
function Team({ employerId, role }: { employerId: string; role: string }) {
  const [members, setMembers] = useState<
    { userId: string; name: string; email: string; role: string }[]
  >([]);
  const [message, setMessage] = useState('');
  const load = useCallback(async () => {
    try {
      setMembers(await api(`employers/${employerId}/team`));
    } catch (e) {
      setMessage((e as Error).message);
    }
  }, [employerId]);
  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);
  return (
    <section className="panel">
      <h2>People behind your hiring.</h2>
      {members.map((m) => (
        <div className="workspace-row" key={m.userId}>
          <div>
            <h3>{m.name}</h3>
            <p>
              {m.email} · {m.role}
            </p>
          </div>
          {role === 'owner' && m.role !== 'owner' && (
            <Button
              variant="ghost"
              onClick={async () => {
                try {
                  await api(`employers/${employerId}/team/${m.userId}`, 'DELETE');
                  await load();
                } catch (e) {
                  setMessage((e as Error).message);
                }
              }}
            >
              Remove access
            </Button>
          )}
        </div>
      ))}
      <form
        className="form-grid"
        onSubmit={async (e) => {
          e.preventDefault();
          const d = new FormData(e.currentTarget);
          try {
            await api(`employers/${employerId}/team`, 'POST', {
              email: d.get('email'),
              role: d.get('role'),
            });
            setMessage('Invitation queued for email delivery.');
          } catch (e) {
            setMessage((e as Error).message);
          }
        }}
      >
        <label>
          Invite email
          <input type="email" name="email" required />
        </label>
        <label>
          Role
          <select name="role">
            <option value="recruiter">Recruiter</option>
            <option value="admin">Administrator</option>
            <option value="viewer">Viewer</option>
          </select>
        </label>
        <Button>Send team invitation</Button>
      </form>
      {message && <Notice>{message}</Notice>}
    </section>
  );
}
function Billing({ employerId }: { employerId: string }) {
  const [data, setData] = useState<{
    subscriptions: { id: string; status: string; endsAt: string; cancelledAt: string | null }[];
    invoices: { id: string; number: string; amount: number; currency: string }[];
    checkouts: { id: string; status: string; provider: string }[];
  } | null>(null);
  const [message, setMessage] = useState('');
  const [plans, setPlans] = useState<{
    plans: { id: string; name: string; amount: number; currency: string }[];
    providers: { stripe: boolean; paystack: boolean };
  } | null>(null);
  const load = useCallback(async () => {
    try {
      const [d, p] = await Promise.all([api(`employers/${employerId}/billing`), api('plans')]);
      setData(d);
      setPlans(p);
    } catch (e) {
      setMessage((e as Error).message);
    }
  }, [employerId]);
  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);
  return (
    <section className="panel">
      <h2>Simple, explicit employer access.</h2>
      <p>
        One free active vacancy. Paid access is a fixed period, with no automatic charge renewal.
        Access starts only after verified settlement.
      </p>
      {plans && (
        <form
          className="form-grid"
          onSubmit={async (e) => {
            e.preventDefault();
            const d = new FormData(e.currentTarget);
            try {
              const result = await api('checkout', 'POST', {
                employerId,
                planId: d.get('planId'),
                provider: d.get('provider'),
              });
              window.location.assign(result.url);
            } catch (e) {
              setMessage((e as Error).message);
            }
          }}
        >
          <label>
            Plan
            <select name="planId">
              {plans.plans.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {p.currency} {(p.amount / 100).toLocaleString()} / 30 days
                </option>
              ))}
            </select>
          </label>
          <label>
            Payment provider
            <select name="provider" required>
              <option value="">Select configured provider</option>
              {plans.providers.stripe && <option value="stripe">Stripe</option>}
              {plans.providers.paystack && <option value="paystack">Paystack</option>}
            </select>
          </label>
          <Button disabled={!plans.providers.stripe && !plans.providers.paystack}>
            Continue to secure checkout
          </Button>
          {!plans.providers.stripe && !plans.providers.paystack && (
            <p>Paid checkout is not configured. Free posting remains available.</p>
          )}
        </form>
      )}
      {data?.subscriptions.map((s) => (
        <div className="workspace-row" key={s.id}>
          <p>
            {s.status} · Paid until {new Date(s.endsAt).toLocaleDateString()} ·{' '}
            {s.cancelledAt ? 'Non-renewing' : 'No automatic renewal'}
          </p>
          <Button
            variant="ghost"
            onClick={async () => {
              try {
                const r = await api('subscriptions/' + s.id + '/cancel', 'POST');
                setMessage(r.message);
                await load();
              } catch (e) {
                setMessage((e as Error).message);
              }
            }}
          >
            Mark non-renewing
          </Button>
        </div>
      ))}
      <h3 style={{ marginTop: 25 }}>Checkout history</h3>
      {data?.checkouts.map((c) => (
        <div className="workspace-row" key={c.id}>
          <span>
            {c.provider} · {c.status}
          </span>
          {c.status === 'pending' && (
            <Button
              variant="secondary"
              onClick={async () => {
                try {
                  await api('checkout/' + c.id + '/reconcile', 'POST');
                  setMessage('Payment verified and settled.');
                  await load();
                } catch (e) {
                  setMessage((e as Error).message);
                }
              }}
            >
              Verify payment
            </Button>
          )}
        </div>
      ))}
      <h3>Receipts</h3>
      {data?.invoices.map((i) => (
        <p key={i.id}>
          {i.number} · {i.currency} {(i.amount / 100).toLocaleString()}
        </p>
      ))}
      {message && <Notice>{message}</Notice>}
    </section>
  );
}

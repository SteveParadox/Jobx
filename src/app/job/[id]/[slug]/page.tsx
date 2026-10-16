import { ExternalApply, NativeApply, ReportJob, SaveJob } from '@/components/actions';
import { JobCard, salary } from '@/components/job-card';
import { Notice } from '@/components/ui';
import { getPublicJob, jobProvenance, searchJobs } from '@/domain/search';
import { active, breadcrumb, eligible, jobPath, jobSchema, metadata } from '@/domain/seo';
import { env } from '@/lib/config';
import { jsonLd } from '@/lib/security';
import Link from 'next/link';
import { notFound, permanentRedirect } from 'next/navigation';
import { z } from 'zod';
export const dynamic = 'force-dynamic';
type Props = { params: Promise<{ id: string; slug: string }> };
async function read(id: string) {
  if (!z.uuid().safeParse(id).success || !env.DATABASE_URL) notFound();
  const job = await getPublicJob(id);
  if (!job) notFound();
  return job;
}
export async function generateMetadata({ params }: Props) {
  const { id } = await params;
  const job = await read(id);
  return metadata(
    `${job.title} at ${job.companyName}`,
    `${job.title} · ${job.companyName} · ${job.locationLabel}. ${job.descriptionText.slice(0, 120)}`,
    jobPath(job),
    eligible(job),
  );
}
export default async function JobDetail({ params }: Props) {
  const { id, slug } = await params;
  const job = await read(id);
  if (slug !== job.slug) permanentRedirect(jobPath(job));
  const open = active(job);
  const schema = jobSchema(job);
  const provenance = await jobProvenance(job.id);
  const similar = job.category ? await searchJobs({ category: job.category }) : { jobs: [] };
  return (
    <div className="container">
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <Link href="/">Home</Link>
        <span>/</span>
        <Link href="/jobs">Jobs</Link>
        <span>/</span>
        <span>{job.title}</span>
      </nav>
      <div className="detail-grid">
        <article>
          <div className="job-heading">
            <Link className="eyebrow" href={'/companies/' + job.companySlug}>
              {job.companyName}
            </Link>
            <h1>{job.title}</h1>
            <div className="job-meta">
              <span>{job.locationLabel}</span>
              <span>{job.workplace === 'unknown' ? 'Workplace not specified' : job.workplace}</span>
              {job.employmentType && <span>{job.employmentType.replaceAll('_', ' ')}</span>}
            </div>
          </div>
          {!open && (
            <Notice>
              This vacancy is {job.status === 'active' ? 'expired' : job.status}. Applications are
              closed. <Link href="/jobs">Explore active openings</Link>.
            </Notice>
          )}
          {job.isDemo && <Notice>Development fixture — this is not a genuine vacancy.</Notice>}
          <div className="prose" dangerouslySetInnerHTML={{ __html: job.descriptionHtml }} />
          {job.skills.length > 0 && (
            <section>
              <h2>Skills disclosed for this role</h2>
              <div className="row-actions">
                {job.skills.map((skill) => (
                  <span className="tag" key={skill}>
                    {skill}
                  </span>
                ))}
              </div>
            </section>
          )}
          {open && job.applicationMethod === 'native' && (
            <NativeApply jobId={job.id} resumeRequired={job.resumeRequired} />
          )}
          <section style={{ marginTop: 40 }}>
            <ReportJob jobId={job.id} />
          </section>
        </article>
        <aside className="panel apply-panel">
          <h2>Your next move</h2>
          {open ? (
            job.applicationMethod === 'external' && job.applyUrl ? (
              <ExternalApply url={job.applyUrl} jobId={job.id} />
            ) : (
              <a href="#apply" className="button button-primary">
                Apply for this role ↗
              </a>
            )
          ) : (
            <Link className="button button-primary" href="/jobs">
              Find active jobs
            </Link>
          )}
          <SaveJob jobId={job.id} />
          <dl className="detail-facts">
            <div>
              <dt>Compensation</dt>
              <dd>{salary(job)}</dd>
            </div>
            <div>
              <dt>Location & eligibility</dt>
              <dd>
                {job.locationLabel}
                {job.workplace === 'remote' && (
                  <>
                    <br />
                    Applicant countries: {job.remoteCountries.join(', ')}
                  </>
                )}
              </dd>
            </div>
            {job.seniority && (
              <div>
                <dt>Seniority</dt>
                <dd>{job.seniority}</dd>
              </div>
            )}
            {job.experienceMin != null && (
              <div>
                <dt>Minimum experience</dt>
                <dd>{job.experienceMin} years</dd>
              </div>
            )}
            {job.education && (
              <div>
                <dt>Education</dt>
                <dd>{job.education}</dd>
              </div>
            )}
            {job.visaSponsorship != null && (
              <div>
                <dt>Visa sponsorship</dt>
                <dd>{job.visaSponsorship ? 'Explicitly offered' : 'Not offered'}</dd>
              </div>
            )}
            <div>
              <dt>Posted</dt>
              <dd>
                {job.originalPostedAt?.toLocaleDateString('en-GB') ??
                  'Original posting date not provided'}
              </dd>
            </div>
            <div>
              <dt>Deadline</dt>
              <dd>
                {job.expiresAt?.toLocaleString('en-GB', { timeZone: 'UTC' }) ?? 'Not specified'}
                {job.expiresAt ? ' UTC' : ''}
              </dd>
            </div>
            <div>
              <dt>Last verified</dt>
              <dd>{job.lastVerifiedAt?.toLocaleDateString('en-GB') ?? 'Awaiting verification'}</dd>
            </div>
            <div>
              <dt>Listing source</dt>
              <dd>
                {job.isDemo
                  ? 'Development fixture'
                  : provenance.length
                    ? provenance
                        .filter((v) => v.enabled)
                        .map((v, i) => (
                          <div key={i}>
                            <a href={v.sourceUrl} target="_blank" rel="noopener noreferrer">
                              {v.attribution} ↗
                            </a>
                          </div>
                        ))
                    : 'Employer-submitted listing'}
                {!job.isDemo &&
                  provenance.length > 0 &&
                  !provenance.some((v) => v.enabled) &&
                  'Original source no longer enabled'}
              </dd>
            </div>
            <div>
              <dt>Application route</dt>
              <dd>
                {job.applicationMethod === 'native'
                  ? 'On CareerAtlas'
                  : 'Employer’s external application site'}
              </dd>
            </div>
          </dl>
          <p style={{ fontSize: 11, margin: 0 }}>
            An external link opens the employer’s application page. A click does not confirm an
            application.
          </p>
          <Link className="text-link" href="/trust">
            Stay safe during your search →
          </Link>
        </aside>
      </div>
      {similar.jobs.filter((v) => v.id !== job.id).length > 0 && (
        <section className="section">
          <h2>More possibilities to explore.</h2>
          <div className="job-list">
            {similar.jobs
              .filter((v) => v.id !== job.id)
              .slice(0, 3)
              .map((j) => (
                <JobCard key={j.id} job={j} />
              ))}
          </div>
        </section>
      )}
      {schema && (
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(schema) }} />
      )}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: jsonLd(
            breadcrumb([
              { name: 'Home', path: '/' },
              { name: 'Jobs', path: '/jobs' },
              { name: job.title, path: jobPath(job) },
            ]),
          ),
        }}
      />
    </div>
  );
}

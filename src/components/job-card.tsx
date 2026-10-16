import type { PublicJob } from '@/domain/search';
import { jobPath } from '@/domain/seo';
import { ArrowUpRight, MapPin } from 'lucide-react';
import Link from 'next/link';
export function salary(
  job: Pick<PublicJob, 'salaryMin' | 'salaryMax' | 'currency' | 'salaryPeriod'>,
) {
  if ((job.salaryMin == null && job.salaryMax == null) || !job.currency)
    return 'Salary not disclosed';
  const fmt = (n: number) =>
    new Intl.NumberFormat('en', {
      style: 'currency',
      currency: job.currency!,
      maximumFractionDigits: 0,
    }).format(n);
  return `${job.salaryMin != null ? fmt(job.salaryMin) : 'Up to ' + fmt(job.salaryMax!)}${job.salaryMin != null && job.salaryMax != null ? ' – ' + fmt(job.salaryMax) : ''} / ${job.salaryPeriod?.toLowerCase() ?? 'period not specified'}`;
}
export function JobCard({ job }: { job: PublicJob & { sponsored?: boolean } }) {
  return (
    <article className="job-card">
      <div className="company-monogram" aria-hidden="true">
        {job.companyName.slice(0, 2).toUpperCase()}
      </div>
      <div className="job-card-main">
        <div className="eyebrow-row">
          <Link href={'/companies/' + job.companySlug}>{job.companyName}</Link>
          {job.sponsored && <span className="tag tag-warm">Sponsored</span>}
          {job.isDemo && <span className="tag tag-warm">Demo fixture</span>}
        </div>
        <h3>
          <Link href={jobPath(job)}>{job.title}</Link>
        </h3>
        <div className="job-meta">
          <span>
            <MapPin size={14} />
            {job.locationLabel}
          </span>
          {job.workplace !== 'unknown' && <span>{job.workplace}</span>}
          {job.employmentType && (
            <span>{job.employmentType.toLowerCase().replaceAll('_', ' ')}</span>
          )}
        </div>
        <div className="job-card-bottom">
          <span>{salary(job)}</span>
          {job.originalPostedAt && (
            <time dateTime={job.originalPostedAt.toISOString()}>
              {job.originalPostedAt.toLocaleDateString('en-GB', {
                day: 'numeric',
                month: 'short',
                year: 'numeric',
              })}
            </time>
          )}
        </div>
      </div>
      <Link className="job-arrow" href={jobPath(job)} aria-label={'View ' + job.title}>
        <ArrowUpRight size={22} />
      </Link>
    </article>
  );
}

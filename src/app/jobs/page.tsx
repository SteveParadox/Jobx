import { AlertForm, SaveSearch } from '@/components/actions';
import { Filters } from '@/components/filters';
import { JobCard } from '@/components/job-card';
import { SearchForm } from '@/components/search-form';
import { SearchHistoryRecorder } from '@/components/search-history';
import { Empty, Notice } from '@/components/ui';
import { searchJobs } from '@/domain/search';
import { metadata } from '@/domain/seo';
import { searchSchema } from '@/domain/validation';
import { env } from '@/lib/config';
import Link from 'next/link';
import { Suspense } from 'react';
export const dynamic = 'force-dynamic';
export const generateMetadata = () =>
  metadata(
    'Search opportunities',
    'Find jobs by role, location, workplace and disclosed compensation.',
    '/jobs',
    false,
  );
export type Query = Record<string, string | string[] | undefined>;
export function cleanQuery(query: Query) {
  return Object.fromEntries(
    Object.entries(query)
      .filter(([, v]) => typeof v === 'string' && v !== '')
      .map(([k, v]) => [k, v as string]),
  );
}
export async function Results({
  query,
  title = 'Find your next opportunity',
  intro = 'Explore jobs with clear sources, real details and direct application routes.',
}: {
  query: Query;
  title?: string;
  intro?: string;
}) {
  const clean = cleanQuery(query);
  const parsed = searchSchema.safeParse(clean);
  const filters = parsed.success ? parsed.data : null;
  const result =
    filters && env.DATABASE_URL
      ? await searchJobs(filters)
      : { jobs: [], total: 0, page: 1, pageSize: 20 };
  const pageUrl = (page: number) =>
    '/jobs?' + new URLSearchParams({ ...clean, page: String(page) });
  return (
    <>
      {filters && env.DATABASE_URL && <SearchHistoryRecorder filters={filters} />}
      <div className="page-header">
        <div className="container">
          <div className="eyebrow">EXPLORE WHAT’S NEXT</div>
          <h1>{title}</h1>
          <p>{intro}</p>
          <SearchForm initialQuery={clean.q} initialCountry={clean.country} compact />
        </div>
      </div>
      <div className="container search-layout">
        <Suspense fallback={<p>Loading filters…</p>}>
          <Filters />
        </Suspense>
        <section>
          <div className="results-toolbar">
            <h2>
              {result.total} active {result.total === 1 ? 'opportunity' : 'opportunities'}
            </h2>
            <SaveSearch filters={clean} />
          </div>
          {!parsed.success && (
            <Notice error>{parsed.error.issues.map((i) => i.message).join('. ')}</Notice>
          )}
          {result.jobs.length ? (
            <div className="job-list">
              {result.jobs.map((job) => (
                <JobCard key={job.id} job={job} />
              ))}
            </div>
          ) : (
            <Empty title="A good search starts with possibilities">
              {env.DATABASE_URL
                ? 'No active vacancies match these criteria. Broaden your filters or create an alert for future openings.'
                : 'Authorized inventory has not been connected yet. No demo roles are shown as live opportunities.'}
            </Empty>
          )}
          {result.total > result.pageSize && (
            <nav className="pagination" aria-label="Search pagination">
              {result.page > 1 && (
                <Link href={pageUrl(result.page - 1)} rel="prev">
                  ← Previous
                </Link>
              )}
              <span>
                Page {result.page} of {Math.ceil(result.total / result.pageSize)}
              </span>
              {result.page * result.pageSize < result.total && (
                <Link href={pageUrl(result.page + 1)} rel="next">
                  Next →
                </Link>
              )}
            </nav>
          )}
          <section className="panel" style={{ marginTop: 30 }}>
            <h2>Let the next opening find you.</h2>
            <p>Get a digest of newly published roles matching this search.</p>
            <AlertForm filters={clean} />
          </section>
        </section>
      </div>
    </>
  );
}
export default async function JobsPage({ searchParams }: { searchParams: Promise<Query> }) {
  return <Results query={await searchParams} />;
}

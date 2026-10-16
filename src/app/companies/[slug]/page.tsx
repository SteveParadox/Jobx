import { JobCard } from '@/components/job-card';
import { Empty } from '@/components/ui';
import { getDb } from '@/db';
import { employers } from '@/db/schema';
import { searchJobs } from '@/domain/search';
import { metadata } from '@/domain/seo';
import { env, isProduction } from '@/lib/config';
import { and, eq } from 'drizzle-orm';
import { notFound } from 'next/navigation';
export const dynamic = 'force-dynamic';
async function read(slug: string) {
  if (!env.DATABASE_URL) notFound();
  const [company] = await getDb()
    .select()
    .from(employers)
    .where(
      and(
        eq(employers.slug, slug),
        eq(employers.verificationStatus, 'verified'),
        eq(employers.disabled, false),
        ...(isProduction || !env.DEMO_MODE ? [eq(employers.isDemo, false)] : []),
      ),
    );
  if (!company) notFound();
  return company;
}
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const c = await read((await params).slug);
  return metadata(
    `${c.name} careers`,
    c.description.slice(0, 160) || `Explore ${c.name} and its current vacancies.`,
    `/companies/${c.slug}`,
    !c.isDemo,
  );
}
export default async function Company({ params }: { params: Promise<{ slug: string }> }) {
  const c = await read((await params).slug);
  const result = await searchJobs({ company: c.id });
  return (
    <div className="container page-container">
      <div className="eyebrow">VERIFIED EMPLOYER PROFILE</div>
      <h1>{c.name}</h1>
      <p style={{ maxWidth: 750 }}>{c.description}</p>
      <dl className="detail-facts" style={{ marginBottom: 30 }}>
        {c.industry && (
          <div>
            <dt>Industry</dt>
            <dd>{c.industry}</dd>
          </div>
        )}
        {c.headquarters && (
          <div>
            <dt>Headquarters</dt>
            <dd>{c.headquarters}</dd>
          </div>
        )}
        {c.size && (
          <div>
            <dt>Company size</dt>
            <dd>{c.size}</dd>
          </div>
        )}
        <div>
          <dt>Official website</dt>
          <dd>
            <a href={c.website} target="_blank" rel="noopener noreferrer">
              {c.website}
            </a>
          </dd>
        </div>
      </dl>
      <h2>Current opportunities</h2>
      {result.jobs.length ? (
        <div className="job-list">
          {result.jobs.map((j) => (
            <JobCard key={j.id} job={j} />
          ))}
        </div>
      ) : (
        <Empty title="No active openings right now">
          Visit again for new roles from this employer.
        </Empty>
      )}
    </div>
  );
}

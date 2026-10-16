import { Empty } from '@/components/ui';
import { getDb } from '@/db';
import { employers, jobs } from '@/db/schema';
import { availability } from '@/domain/search';
import { metadata } from '@/domain/seo';
import { env } from '@/lib/config';
import { eq, sql } from 'drizzle-orm';
import Link from 'next/link';
export const dynamic = 'force-dynamic';
export const generateMetadata = () =>
  metadata(
    'Explore hiring companies',
    'Explore employers with verified profiles and currently available opportunities.',
    '/companies',
  );
export default async function Companies() {
  const companies = env.DATABASE_URL
    ? await getDb()
        .select({
          name: employers.name,
          slug: employers.slug,
          description: employers.description,
          count: sql<number>`count(*)::int`,
        })
        .from(employers)
        .innerJoin(jobs, eq(jobs.employerId, employers.id))
        .where(availability())
        .groupBy(employers.id)
        .limit(100)
    : [];
  return (
    <div className="container page-container">
      <div className="eyebrow">KNOW WHO’S HIRING</div>
      <h1>Explore the teams behind the work.</h1>
      <p>Verified company profiles with active opportunities.</p>
      {companies.length ? (
        <div className="company-grid">
          {companies.map((c) => (
            <Link href={'/companies/' + c.slug} key={c.slug} className="company-card">
              <div className="company-monogram">{c.name.slice(0, 2)}</div>
              <h2>{c.name}</h2>
              <p>{c.description.slice(0, 150)}</p>
              <span>{c.count} active roles →</span>
            </Link>
          ))}
        </div>
      ) : (
        <Empty title="Meet your next team, soon.">
          Company profiles appear here when verified employers have active openings.
        </Empty>
      )}
    </div>
  );
}

import { getDb } from '@/db';
import { editorial } from '@/db/schema';
import { guides } from '@/domain/content';
import { metadata } from '@/domain/seo';
import { env } from '@/lib/config';
import { eq } from 'drizzle-orm';
import Link from 'next/link';
export const dynamic = 'force-dynamic';
export const generateMetadata = () =>
  metadata(
    'Career resources',
    'Practical guidance on résumés, interviews, remote work and comparing opportunities.',
    '/resources',
  );
export default async function Resources() {
  const entries = env.DATABASE_URL
    ? await getDb().select().from(editorial).where(eq(editorial.published, true))
    : [];
  return (
    <div className="container page-container">
      <div className="eyebrow">A LITTLE DIRECTION GOES A LONG WAY</div>
      <h1>Build your next chapter with confidence.</h1>
      <p>Practical guidance. Clear questions. Honest applications.</p>
      <div className="resource-grid">
        {[...Object.entries(guides).map(([slug, v]) => ({ ...v, slug })), ...entries].map(
          (g, i) => (
            <Link key={g.slug} href={'/resources/' + g.slug} className="resource-card">
              <div className="resource-top">
                <span>CAREER GUIDE</span>
                <span>{String(i + 1).padStart(2, '0')}</span>
              </div>
              <h2>{g.title}</h2>
              <p>{g.summary}</p>
              <span>Read guide ↗</span>
            </Link>
          ),
        )}
      </div>
    </div>
  );
}

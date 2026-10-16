import { getDb } from '@/db';
import { editorial } from '@/db/schema';
import { guides } from '@/domain/content';
import { metadata } from '@/domain/seo';
import { env } from '@/lib/config';
import { and, eq } from 'drizzle-orm';
import { notFound } from 'next/navigation';
export const dynamic = 'force-dynamic';
async function read(slug: string) {
  if (guides[slug])
    return {
      ...guides[slug],
      author: 'CareerAtlas editorial',
      updatedAt: new Date('2026-10-16T00:00:00Z'),
    };
  if (!env.DATABASE_URL) notFound();
  const [page] = await getDb()
    .select()
    .from(editorial)
    .where(and(eq(editorial.slug, slug), eq(editorial.published, true)));
  if (!page) notFound();
  return page;
}
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const page = await read(slug);
  return metadata(page.title, page.summary, '/resources/' + slug);
}
export default async function Resource({ params }: { params: Promise<{ slug: string }> }) {
  const page = await read((await params).slug);
  return (
    <article className="container narrow page-container">
      <div className="eyebrow">CAREER RESOURCES</div>
      <h1>{page.title}</h1>
      <p>{page.summary}</p>
      <p style={{ fontSize: 11 }}>
        By {page.author} · Updated {page.updatedAt.toLocaleDateString('en-GB')}
      </p>
      <div className="prose" dangerouslySetInnerHTML={{ __html: page.bodyHtml }} />
    </article>
  );
}

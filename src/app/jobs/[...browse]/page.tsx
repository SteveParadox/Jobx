import { getLanding } from '@/domain/landings';
import { metadata } from '@/domain/seo';
import { env } from '@/lib/config';
import { notFound } from 'next/navigation';
import { Results } from '../page';
export const dynamic = 'force-dynamic';
async function landing(params: Promise<{ browse: string[] }>) {
  const p = await params;
  if (!env.DATABASE_URL) notFound();
  const path = '/jobs/' + p.browse.join('/');
  const data = await getLanding(path);
  if (!data) notFound();
  return { path, data };
}
export async function generateMetadata({ params }: { params: Promise<{ browse: string[] }> }) {
  const { path, data } = await landing(params);
  return metadata(data.title, data.description, path);
}
export default async function Landing({ params }: { params: Promise<{ browse: string[] }> }) {
  const { data } = await landing(params);
  return (
    <>
      <div
        className="container prose page-container"
        dangerouslySetInnerHTML={{ __html: data.bodyHtml }}
      />
      <Results
        query={Object.fromEntries(
          Object.entries(data.filters)
            .filter(([, v]) => v !== undefined)
            .map(([k, v]) => [k, String(v)]),
        )}
        title={data.title}
        intro={data.description}
      />
    </>
  );
}

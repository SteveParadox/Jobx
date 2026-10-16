import { renderSitemap, sitemapEntries } from '@/domain/sitemaps';
export const dynamic = 'force-dynamic';
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ kind: string; page: string }> },
) {
  const { kind, page } = await params;
  if (
    !['jobs', 'companies', 'editorial', 'landings', 'static'].includes(kind) ||
    !/^\d{1,6}\.xml$/.test(page)
  )
    return new Response('Not found', { status: 404 });
  return new Response(renderSitemap(await sitemapEntries(kind, Number(page.slice(0, -4)))), {
    headers: {
      'Content-Type': 'application/xml',
      'Cache-Control': 'public, max-age=60, must-revalidate',
    },
  });
}

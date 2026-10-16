import { sitemapIndex } from '@/domain/sitemaps';
export const dynamic = 'force-dynamic';
export async function GET() {
  const urls = await sitemapIndex();
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map((url) => `<sitemap><loc>${url.replace(/&/g, '&amp;')}</loc></sitemap>`).join('')}</sitemapindex>`,
    {
      headers: {
        'Content-Type': 'application/xml',
        'Cache-Control': 'public, max-age=60, must-revalidate',
      },
    },
  );
}

import { brand, isProduction } from '@/lib/config';
import type { MetadataRoute } from 'next';
export const dynamic = 'force-dynamic';
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/api/', '/dashboard', '/employers', '/admin', '/auth', '/invite', '/unsubscribe'],
    },
    ...(isProduction ? { sitemap: brand.url + '/sitemap.xml' } : {}),
  };
}

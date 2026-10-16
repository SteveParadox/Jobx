import { ProductAnalytics } from '@/components/analytics';
import { Footer, Header } from '@/components/shell';
import { brand, isProduction } from '@/lib/config';
import type { Metadata } from 'next';
import type { CSSProperties, ReactNode } from 'react';
import { Suspense } from 'react';
import './globals.css';
export const metadata: Metadata = {
  metadataBase: new URL(brand.url),
  title: { default: `${brand.name} · Find your next direction`, template: `%s | ${brand.name}` },
  description:
    'Discover verified employer opportunities, clear application routes and helpful career resources.',
  robots: { index: isProduction, follow: true },
  icons: { icon: '/icon.svg' },
};
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ '--brand': brand.color } as CSSProperties}>
        <a href="#main" className="skip-link">
          Skip to content
        </a>
        <Header />
        <main id="main">{children}</main>
        <Footer />
        <Suspense>
          <ProductAnalytics />
        </Suspense>
      </body>
    </html>
  );
}

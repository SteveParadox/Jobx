'use client';
import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect } from 'react';
export function ProductAnalytics() {
  const path = usePathname();
  const query = useSearchParams();
  useEffect(() => {
    if (localStorage.getItem('careeratlas-consent') !== 'analytics') return;
    const event = path.startsWith('/job/')
      ? 'job_detail_viewed'
      : path === '/jobs' || path === '/remote-jobs'
        ? 'search_results_viewed'
        : null;
    if (!event) return;
    const jobId = path.startsWith('/job/') ? path.split('/')[2] : undefined;
    void fetch('/api/platform/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event,
        jobId,
        consent: true,
        properties: { hasQuery: Boolean(query.get('q')), filtered: query.size > 0 },
      }),
    }).catch(() => {
      /* Analytics must not block a public page. */
    });
  }, [path, query]);
  return null;
}

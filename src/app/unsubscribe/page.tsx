import { Unsubscribe } from '@/components/invite';
import { Suspense } from 'react';
export const metadata = { title: 'Unsubscribe', robots: { index: false, follow: false } };
export default function UnsubscribePage() {
  return (
    <Suspense>
      <Unsubscribe />
    </Suspense>
  );
}

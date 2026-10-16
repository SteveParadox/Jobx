import { Invitation } from '@/components/invite';
import { Suspense } from 'react';
export const metadata = {
  title: 'Accept team invitation',
  robots: { index: false, follow: false },
};
export default function Invite() {
  return (
    <Suspense>
      <Invitation />
    </Suspense>
  );
}

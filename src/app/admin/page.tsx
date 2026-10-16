import { AdminWorkspace } from '@/components/admin-workspace';
import { metadata } from '@/domain/seo';
export const generateMetadata = () =>
  metadata(
    'Platform administration',
    'Authorized platform operations, moderation and source management.',
    '/admin',
    false,
  );
export default function Admin() {
  return <AdminWorkspace />;
}

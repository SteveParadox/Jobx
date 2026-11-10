import { FederatedSearch } from '@/components/federated-search';
import { metadata } from '@/domain/seo';
export const dynamic = 'force-dynamic';
export const generateMetadata = () =>
  metadata(
    'Search across job sources',
    'Search the Jobx catalog and configured job API partners. Verify external vacancies at their sources.',
    '/discover',
    false,
  );
export default function Discover() {
  return <FederatedSearch />;
}

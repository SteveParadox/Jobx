import { metadata } from '@/domain/seo';
import { Results, type Query } from '../jobs/page';
export const dynamic = 'force-dynamic';
export const generateMetadata = () =>
  metadata(
    'Explore remote opportunities',
    'Find fully remote roles and check the applicant countries each employer explicitly supports.',
    '/remote-jobs',
    false,
  );
export default async function RemoteJobs({ searchParams }: { searchParams: Promise<Query> }) {
  return (
    <Results
      query={{ ...(await searchParams), workplace: 'remote' }}
      title="Work beyond borders."
      intro="Remote does not always mean anywhere. Check each employer’s country eligibility, working hours and application details."
    />
  );
}

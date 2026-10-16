import { CandidateWorkspace } from '@/components/candidate-workspace';
import { metadata } from '@/domain/seo';
export const generateMetadata = () =>
  metadata(
    'Your career workspace',
    'Manage saved opportunities, applications, alerts, profile and private documents.',
    '/dashboard',
    false,
  );
export default function Dashboard() {
  return <CandidateWorkspace />;
}

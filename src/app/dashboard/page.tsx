import { CandidateWorkspace } from '@/components/candidate-workspace';
import { metadata } from '@/domain/seo';
import { currentActor } from '@/lib/auth';
import { redirect } from 'next/navigation';
export const dynamic = 'force-dynamic';
export const generateMetadata = () =>
  metadata(
    'Your career workspace',
    'Manage saved opportunities, applications, alerts, profile and private documents.',
    '/dashboard',
    false,
  );
export default async function Dashboard() {
  // Redirect before mounting the client workspace so anonymous visitors do not
  // fire an avoidable dashboard request that returns 401.
  const actor = await currentActor();
  if (!actor) redirect('/auth?next=%2Fdashboard');
  if (!actor.emailVerified) redirect('/auth?next=%2Fdashboard&error=email_not_verified');
  return <CandidateWorkspace />;
}

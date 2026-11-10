import { EmployerWorkspace } from '@/components/employer-workspace';
import { metadata } from '@/domain/seo';
import { env } from '@/lib/config';
export const generateMetadata = () =>
  metadata(
    'Employer workspace',
    'Create your company profile, submit vacancies for review and manage native applications.',
    '/employers',
    false,
  );
export default function Employers() {
  return (
    <EmployerWorkspace
      googleEnabled={Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET)}
      githubEnabled={Boolean(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET)}
    />
  );
}

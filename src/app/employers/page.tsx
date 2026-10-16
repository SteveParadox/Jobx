import { EmployerWorkspace } from '@/components/employer-workspace';
import { metadata } from '@/domain/seo';
export const generateMetadata = () =>
  metadata(
    'Employer workspace',
    'Create your company profile, submit vacancies for review and manage native applications.',
    '/employers',
    false,
  );
export default function Employers() {
  return <EmployerWorkspace />;
}

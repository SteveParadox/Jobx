import { getDb } from '@/db';
import { plans } from '@/db/schema';
import { metadata } from '@/domain/seo';
import { env } from '@/lib/config';
import { eq } from 'drizzle-orm';
import Link from 'next/link';
export const dynamic = 'force-dynamic';
export const generateMetadata = () =>
  metadata(
    'Employer plans',
    'Free posting and clear fixed-period employer plans. Job seekers never pay to search or apply.',
    '/pricing',
  );
export default async function Pricing() {
  const data = env.DATABASE_URL
    ? await getDb().select().from(plans).where(eq(plans.enabled, true))
    : [];
  return (
    <div className="container narrow page-container">
      <div className="eyebrow">BUILD A TEAM WITH CLARITY</div>
      <h1>Opportunity stays open.</h1>
      <p>
        Job seekers browse and apply for free. Employers can begin with a verified company and one
        active vacancy.
      </p>
      <div className="pricing-grid">
        <div className="panel">
          <h2>Employer Starter</h2>
          <p className="price">Free</p>
          <ul>
            <li>One active vacancy</li>
            <li>Verified company profile</li>
            <li>Native or external applications</li>
            <li>Recruiter workspace</li>
          </ul>
          <Link href="/employers" className="button button-primary">
            Start hiring ↗
          </Link>
        </div>
        {data.map((p) => (
          <div className="panel" key={p.id}>
            <h2>{p.name}</h2>
            <p className="price">
              {new Intl.NumberFormat('en', {
                style: 'currency',
                currency: p.currency,
                maximumFractionDigits: 0,
              }).format(p.amount / 100)}
            </p>
            <p>For {p.durationDays} days. No automatic charge renewal.</p>
            <ul>
              <li>Up to {p.activeJobs} active vacancies</li>
              <li>Employer team collaboration</li>
              <li>Native applicant management</li>
              <li>Eligible for clearly labeled featured placements</li>
            </ul>
            <Link href="/employers" className="button button-primary">
              Choose in employer workspace
            </Link>
          </div>
        ))}
      </div>
      {!data.length && (
        <p style={{ marginTop: 20 }}>
          Paid plans appear once the database and payment configuration are available.
        </p>
      )}
      <p className="legal-note">
        Company verification and job moderation apply to all plans. Buying access does not bypass
        review or guarantee applications.
      </p>
    </div>
  );
}

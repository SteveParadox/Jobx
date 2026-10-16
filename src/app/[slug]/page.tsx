import { ContactForm, CookiePreferences } from '@/components/contact-form';
import { metadata } from '@/domain/seo';
import Link from 'next/link';
import { notFound } from 'next/navigation';
const pages: Record<string, { title: string; description: string; body: string }> = {
  about: {
    title: 'A clearer direction for your career.',
    description: 'Learn how CareerAtlas approaches transparent job discovery.',
    body: '<p>CareerAtlas connects candidates with clear, source-attributed opportunities and helps employers manage honest recruitment. We show information supplied by employers and authorized sources, and leave undisclosed details unknown.</p><p>Job search is free for candidates. Employers can use a free allowance or choose fixed-period paid access. Paid placements are labeled and do not bypass verification.</p>',
  },
  contact: {
    title: 'Let’s find the right direction.',
    description: 'Contact the CareerAtlas support team.',
    body: '<p>Ask about your account, employer verification, source authorization or an accessibility issue. Do not include passwords, payment card details or private identity documents.</p>',
  },
  faq: {
    title: 'A few useful answers.',
    description: 'Answers about job sources, applications, alerts and employer posting.',
    body: '<h2>Is searching free?</h2><p>Yes. Candidates do not pay CareerAtlas to browse or apply to vacancies.</p><h2>Does remote mean I can apply from anywhere?</h2><p>No. Check the stated applicant countries and confirm eligibility with the employer.</p><h2>Did clicking Apply submit my application?</h2><p>For external jobs, the link opens the employer site. Only that site can confirm its submission. CareerAtlas native applications show confirmation after the database accepts the application.</p><h2>Why is salary missing?</h2><p>We do not invent undisclosed compensation. Ask the employer for details.</p><h2>How are alerts controlled?</h2><p>Create, pause or delete an alert in your workspace. Each email digest includes an unsubscribe link.</p>',
  },
  help: {
    title: 'A little help for your next step.',
    description: 'Help with accounts, job search, applications and employer workflows.',
    body: '<h2>Candidate accounts</h2><p>Create an account, verify your email and sign in. Password reset is available from the account access page. Public job descriptions and external apply links do not require an account.</p><h2>Employer posting</h2><p>Set up your company in the employer workspace. Create a draft, review its description and submit it for moderation. Employer verification and job review are required before publication.</p><h2>Private documents</h2><p>Upload PDFs up to 5 MB. Files stay quarantined until security review. Only clean documents can be used for native applications.</p><h2>Payment verification</h2><p>Use Verify payment in your employer billing history if a payment completed but access has not appeared. A checkout redirect does not prove payment.</p>',
  },
  trust: {
    title: 'A trustworthy search starts with clear signals.',
    description: 'How to identify suspicious vacancies and report concerns.',
    body: '<h2>Check the employer and the destination</h2><p>Compare the company’s official careers page with the application URL. Verification indicates an identity review; it does not guarantee a job offer or the conduct of every person claiming to recruit.</p><h2>Never pay an application fee</h2><p>Requests for candidate payments, banking passwords, cryptocurrency transfers or purchases from an unknown equipment vendor are warning signs. Do not provide account credentials.</p><h2>Report concerns</h2><p>Use Report this job on the listing. Describe the concern without sharing sensitive personal information. Administrators can review the report and disable accounts, sources and listings while preserving an audit trail.</p><h2>Know what is confirmed</h2><p>We distinguish original posting dates, last verification dates, external apply clicks and native submissions. Unknown salary, experience or sponsorship details stay unknown.</p>',
  },
  privacy: {
    title: 'Your information deserves clear boundaries.',
    description: 'How CareerAtlas handles account, application and document information.',
    body: '<p>CareerAtlas stores account details, selected profile information, saved searches, alerts and applications to deliver the features you request. Employer teams can access native applications for their own organization. Candidate files are private and access links expire after one minute.</p><h2>Your controls</h2><p>Manage alerts and documents in your workspace. Export your data as JSON. Account erasure removes credentials, profile and candidate records; limited accounting and security audit records may need retention. Employer owners must transfer ownership before erasure.</p><h2>Service providers</h2><p>Configured email, storage, authentication and payment providers process the data necessary for their services. AI résumé processing is disabled. Optional product analytics do not collect résumé content or candidate contact information.</p><h2>Retention and review</h2><p>Raw source payloads are pruned after 30 days of inactivity. Production account, accounting, support and audit retention periods must be established by the operator and reviewed for the jurisdictions served, including Nigeria and the EEA where applicable.</p><p>This notice must be completed with the operating entity, contact details, provider list, retention schedule and legal basis before a public production launch. It is not a claim of regulatory certification.</p>',
  },
  terms: {
    title: 'Clear expectations for everyone.',
    description: 'Terms for candidates, employers and authorized job sources.',
    body: '<h2>Accurate information</h2><p>Employers must have authority to recruit for the organization and publish only truthful vacancies. Sources must have recorded permission covering redistribution and removal requirements. Candidates must submit accurate information.</p><h2>Recruitment is the employer’s decision</h2><p>CareerAtlas does not guarantee employment, applications, ranking or search-engine indexing. External applications are handled by the destination service. Do not demand candidate application fees or misuse applicant information.</p><h2>Employer access</h2><p>Paid access is a fixed paid period shown at checkout. No automatic renewal charges are enabled. Publication remains subject to verification, moderation and the active-job allowance. Refund requests are reviewed through support.</p><h2>Operator details</h2><p>Before production launch, the operator must complete its legal entity, governing terms, support contact, refund policy and jurisdiction-specific notices with appropriate legal review.</p>',
  },
  accessibility: {
    title: 'Work should be within reach.',
    description: 'Accessibility practices and how to report barriers.',
    body: '<p>CareerAtlas uses semantic headings, labeled forms, visible keyboard focus, responsive layouts and reduced-motion support. Mobile filters use a focus-managed dialog.</p><p>We target WCAG 2.2 AA practices. This is not a certification of full conformance. Automated and assistive-technology testing must accompany production changes.</p><h2>Tell us about a barrier</h2><p>Contact support with the page, the task you were attempting, your device and any assistive technology you use. Do not include private account credentials.</p>',
  },
  cookies: {
    title: 'Choose what stays in your browser.',
    description: 'Manage essential cookies and optional product analytics.',
    body: '',
  },
  offline: {
    title: 'You appear to be offline.',
    description: 'Reconnect to continue your job search.',
    body: '<p>Check your connection and reload the page. Applications require a connection and a server confirmation. An unsent form has not been submitted.</p>',
  },
  forbidden: {
    title: 'This space requires permission.',
    description: 'The account does not have access to this operation.',
    body: '<p>Sign in with an account authorized for the employer team or administration area. Contact the organization owner if you believe access is missing.</p>',
  },
};
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const p = pages[slug];
  if (!p) notFound();
  return metadata(
    p.title,
    p.description,
    '/' + slug,
    !['offline', 'forbidden', 'cookies'].includes(slug),
  );
}
export default async function SupportPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const p = pages[slug];
  if (!p) notFound();
  return (
    <article className="container narrow page-container">
      <div className="eyebrow">CAREERATLAS · HERE TO HELP</div>
      <h1>{p.title}</h1>
      <div className="prose" dangerouslySetInnerHTML={{ __html: p.body }} />
      {slug === 'contact' && <ContactForm />}
      {slug === 'cookies' && <CookiePreferences />}
      {!['contact', 'cookies'].includes(slug) && (
        <Link href="/contact" className="text-link">
          Contact our team →
        </Link>
      )}
    </article>
  );
}

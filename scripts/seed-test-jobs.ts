import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { closeDb, getDb } from '../src/db';
import * as s from '../src/db/schema';
import { fingerprint } from '../src/domain/jobs';
import { plainText, slugify } from '../src/lib/security';
const db = getDb();
const employerSlug = 'jobx-test-company';
const employerValues = {
  name: 'Jobx Test Company',
  slug: employerSlug,
  description:
    'Fictional employer used to exercise search, applications and moderation flows in local testing.',
  website: 'https://example.com',
  industry: 'Software',
  headquarters: 'Lagos, Nigeria',
  verificationStatus: 'verified',
  disabled: false,
  isDemo: false,
};
const now = new Date();
const day = 24 * 60 * 60 * 1000;
const posts = [
  {
    title: 'Senior Frontend Engineer',
    locationLabel: 'Remote (Africa)',
    country: null,
    workplace: 'remote' as const,
    remoteCountries: ['NG', 'GH', 'KE', 'ZA'],
    employmentType: 'FULL_TIME',
    category: 'Software engineering',
    seniority: 'senior',
    skills: ['TypeScript', 'React', 'Next.js'],
    experienceMin: 5,
    salaryMin: 9000000,
    salaryMax: 14000000,
    currency: 'NGN',
    salaryPeriod: 'YEAR',
    visaSponsorship: false,
    applicationMethod: 'native' as const,
    applyUrl: null,
    resumeRequired: false,
    descriptionHtml:
      '<p>Build accessible candidate-facing interfaces with React and Next.js. Own component quality, performance budgets and design collaboration. Work with product and backend engineers to ship weekly improvements to the job discovery experience.</p>',
  },
  {
    title: 'Backend Engineer (Node.js)',
    locationLabel: 'Lagos, Nigeria',
    country: 'NG',
    city: 'Lagos',
    region: 'Lagos',
    workplace: 'onsite' as const,
    employmentType: 'FULL_TIME',
    category: 'Software engineering',
    seniority: 'mid',
    skills: ['Node.js', 'PostgreSQL', 'Drizzle ORM'],
    experienceMin: 3,
    salaryMin: 7000000,
    salaryMax: 11000000,
    currency: 'NGN',
    salaryPeriod: 'YEAR',
    visaSponsorship: true,
    applicationMethod: 'native' as const,
    applyUrl: null,
    resumeRequired: true,
    descriptionHtml:
      '<p>Design and maintain TypeScript services backed by PostgreSQL. Work on ingestion pipelines, background jobs and API reliability. Candidates should be comfortable with SQL, testing and production observability.</p>',
  },
  {
    title: 'DevOps Engineer',
    locationLabel: 'Remote (Africa)',
    country: null,
    workplace: 'remote' as const,
    remoteCountries: ['NG', 'KE', 'ZA'],
    employmentType: 'CONTRACTOR',
    category: 'Infrastructure',
    seniority: 'mid',
    skills: ['Docker', 'Kubernetes', 'Terraform', 'AWS'],
    experienceMin: 4,
    salaryMin: 6000,
    salaryMax: 9000,
    currency: 'USD',
    salaryPeriod: 'MONTH',
    visaSponsorship: false,
    applicationMethod: 'external' as const,
    applyUrl: 'https://example.com/careers/devops-engineer',
    resumeRequired: false,
    descriptionHtml:
      '<p>Operate container platforms, CI pipelines and infrastructure as code. Improve deployment safety, monitoring and incident response. This external application records the destination URL for testing the outbound apply flow.</p>',
  },
  {
    title: 'Product Designer',
    locationLabel: 'Lagos, Nigeria',
    country: 'NG',
    city: 'Lagos',
    region: 'Lagos',
    workplace: 'hybrid' as const,
    employmentType: 'FULL_TIME',
    category: 'Design',
    seniority: 'mid',
    skills: ['Figma', 'Interaction design', 'User research'],
    experienceMin: 3,
    visaSponsorship: false,
    applicationMethod: 'native' as const,
    applyUrl: null,
    resumeRequired: false,
    descriptionHtml:
      '<p>Shape end-to-end product experiences for job seekers and recruiters. Run discovery interviews, prototype flows and maintain a practical design system. Collaborate closely with engineering and content teams.</p>',
  },
  {
    title: 'Data Analyst',
    locationLabel: 'Abuja, Nigeria',
    country: 'NG',
    city: 'Abuja',
    workplace: 'onsite' as const,
    employmentType: 'FULL_TIME',
    category: 'Data',
    seniority: 'junior',
    skills: ['SQL', 'Python', 'Data visualization'],
    experienceMin: 1,
    salaryMin: 4000000,
    salaryMax: 6000000,
    currency: 'NGN',
    salaryPeriod: 'YEAR',
    visaSponsorship: false,
    applicationMethod: 'external' as const,
    applyUrl: 'https://example.com/careers/data-analyst',
    resumeRequired: false,
    descriptionHtml:
      '<p>Turn product and operations data into clear decisions. Build SQL reports, validate metrics and present findings to non-technical stakeholders. A portfolio of analysis work is welcome during the interview process.</p>',
  },
  {
    title: 'QA Automation Engineer',
    locationLabel: 'Remote (West Africa)',
    country: null,
    workplace: 'remote' as const,
    remoteCountries: ['NG', 'GH'],
    employmentType: 'FULL_TIME',
    category: 'Quality assurance',
    seniority: 'mid',
    skills: ['Playwright', 'TypeScript', 'API testing'],
    experienceMin: 3,
    salaryMin: 5000000,
    salaryMax: 8000000,
    currency: 'NGN',
    salaryPeriod: 'YEAR',
    visaSponsorship: false,
    applicationMethod: 'native' as const,
    applyUrl: null,
    resumeRequired: true,
    descriptionHtml:
      '<p>Own automated coverage for critical candidate and employer workflows. Write reliable Playwright tests, maintain fixtures and investigate flaky failures. Partner with engineers to improve testability across the stack.</p>',
  },
  {
    title: 'Mobile Engineer (React Native)',
    locationLabel: 'Lagos, Nigeria',
    country: 'NG',
    city: 'Lagos',
    workplace: 'hybrid' as const,
    employmentType: 'FULL_TIME',
    category: 'Mobile engineering',
    seniority: 'mid',
    skills: ['React Native', 'TypeScript', 'Expo'],
    experienceMin: 3,
    salaryMin: 7000000,
    salaryMax: 10000000,
    currency: 'NGN',
    salaryPeriod: 'YEAR',
    visaSponsorship: true,
    applicationMethod: 'native' as const,
    applyUrl: null,
    resumeRequired: false,
    descriptionHtml:
      '<p>Ship a dependable mobile job-search experience using React Native. Own releases, offline behavior and accessibility, and work with backend engineers on API contracts and performance.</p>',
  },
  {
    title: 'Engineering Manager',
    locationLabel: 'Remote (Africa and Middle East)',
    country: null,
    workplace: 'remote' as const,
    remoteCountries: ['NG', 'KE', 'ZA', 'EG'],
    employmentType: 'FULL_TIME',
    category: 'Engineering management',
    seniority: 'lead',
    skills: ['People management', 'Delivery', 'Hiring'],
    experienceMin: 7,
    visaSponsorship: false,
    applicationMethod: 'external' as const,
    applyUrl: 'https://example.com/careers/engineering-manager',
    resumeRequired: false,
    descriptionHtml:
      '<p>Guide a distributed engineering team through planning, delivery and career growth. Balance technical direction with people leadership and cross-functional coordination. Prior experience managing remote teams is preferred.</p>',
  },
  {
    title: 'Technical Writer',
    locationLabel: 'Remote (Worldwide)',
    country: null,
    workplace: 'remote' as const,
    remoteCountries: ['NG', 'GH', 'KE', 'ZA', 'EG', 'GB', 'US'],
    employmentType: 'PART_TIME',
    category: 'Content',
    seniority: 'mid',
    skills: ['Technical writing', 'Information architecture', 'Markdown'],
    experienceMin: 2,
    salaryMin: 2500,
    salaryMax: 4000,
    currency: 'USD',
    salaryPeriod: 'MONTH',
    visaSponsorship: false,
    applicationMethod: 'native' as const,
    applyUrl: null,
    resumeRequired: false,
    descriptionHtml:
      '<p>Document APIs, operator runbooks and candidate-facing guidance. Improve clarity, structure and consistency across the knowledge base. Strong technical judgment and concise writing samples are required.</p>',
  },
  {
    title: 'Customer Success Specialist',
    locationLabel: 'Accra, Ghana',
    country: 'GH',
    city: 'Accra',
    region: 'Greater Accra',
    workplace: 'onsite' as const,
    employmentType: 'FULL_TIME',
    category: 'Customer success',
    seniority: 'junior',
    skills: ['Communication', 'Support operations', 'CRM'],
    experienceMin: 1,
    salaryMin: 3000,
    salaryMax: 4500,
    currency: 'GHS',
    salaryPeriod: 'MONTH',
    visaSponsorship: false,
    applicationMethod: 'external' as const,
    applyUrl: 'https://example.com/careers/customer-success',
    resumeRequired: false,
    descriptionHtml:
      '<p>Support employers through onboarding, job publishing and billing questions. Maintain clear help content, triage issues with engineering and report recurring customer feedback to the product team.</p>',
  },
];
await db.transaction(async (tx) => {
  const [existingEmployer] = await tx
    .select()
    .from(s.employers)
    .where(eq(s.employers.slug, employerSlug))
    .limit(1);
  const employer =
    existingEmployer ??
    (
      await tx
        .insert(s.employers)
        .values({ id: randomUUID(), ...employerValues })
        .returning()
    )[0];
  let inserted = 0;
  for (const [index, post] of posts.entries()) {
    const descriptionText = plainText(post.descriptionHtml);
    const postFingerprint = fingerprint(
      post.title,
      post.locationLabel,
      descriptionText,
      post.applyUrl ?? '',
    );
    const [existing] = await tx
      .select({ id: s.jobs.id })
      .from(s.jobs)
      .where(and(eq(s.jobs.employerId, employer.id), eq(s.jobs.fingerprint, postFingerprint)))
      .limit(1);
    if (existing) continue;
    await tx.insert(s.jobs).values({
      ...post,
      employerId: employer.id,
      slug: `${slugify(post.title)}-test`,
      descriptionText,
      fingerprint: postFingerprint,
      status: 'active',
      isDemo: false,
      originalPostedAt: new Date(now.getTime() - (index + 1) * day),
      firstDiscoveredAt: new Date(now.getTime() - (index + 1) * day),
      lastVerifiedAt: now,
      publishedAt: now,
      expiresAt: new Date(now.getTime() + 60 * day),
    });
    inserted++;
  }
  console.log(`Employer: ${employer.name} (${employer.slug})`);
  console.log(`Inserted ${inserted} test job posts (${posts.length} total configured).`);
});
await closeDb();

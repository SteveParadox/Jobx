import { hashPassword } from 'better-auth/crypto';
import { closeDb, getDb } from '../src/db';
import * as s from '../src/db/schema';
import { fingerprint } from '../src/domain/jobs';
import { env } from '../src/lib/config';
import { plainText, slugify } from '../src/lib/security';
if (!['development', 'test'].includes(env.APP_ENV) || !env.DEMO_MODE)
  throw new Error('Seed requires development/test and explicit DEMO_MODE=true');
const db = getDb();
const password = 'Local-demo-password-2026!';
const credentials = [
  {
    id: 'demo-candidate',
    email: 'candidate@example.invalid',
    name: 'Demo Candidate',
    role: 'candidate',
  },
  {
    id: 'demo-employer',
    email: 'employer@example.invalid',
    name: 'Demo Recruiter',
    role: 'candidate',
  },
  { id: 'demo-admin', email: 'admin@example.invalid', name: 'Demo Administrator', role: 'admin' },
];
await db.transaction(async (tx) => {
  for (const u of credentials) {
    await tx
      .insert(s.user)
      .values({ ...u, emailVerified: true })
      .onConflictDoNothing();
    await tx
      .insert(s.account)
      .values({
        id: 'credential-' + u.id,
        accountId: u.id,
        providerId: 'credential',
        userId: u.id,
        password: await hashPassword(password),
      })
      .onConflictDoNothing();
  }
  const companyId = '7e883f89-1164-4b04-a85b-16fc02d7fc5b';
  await tx
    .insert(s.employers)
    .values({
      id: companyId,
      name: 'Demo Studio — fictional fixture',
      slug: 'demo-studio',
      description: 'Development fixture only. This company and its jobs are not real vacancies.',
      website: 'https://example.com',
      verificationStatus: 'verified',
      isDemo: true,
    })
    .onConflictDoNothing();
  await tx
    .insert(s.memberships)
    .values({ employerId: companyId, userId: 'demo-employer', role: 'owner' })
    .onConflictDoNothing();
  for (let i = 1; i <= 26; i++) {
    const id = `11111111-1111-4111-8111-${String(i).padStart(12, '0')}`;
    const title =
      i === 1
        ? 'Demo Backend Engineer'
        : i === 2
          ? 'Demo External Engineer'
          : `Demo Software Engineer ${i}`;
    const descriptionHtml =
      '<p>Development fixture, not a real vacancy. Build and test a sample service with a fictional product team. This record exists to exercise search, moderation, saved jobs and application workflows in local development.</p>';
    await tx
      .insert(s.jobs)
      .values({
        id,
        employerId: companyId,
        title,
        slug: slugify(title),
        descriptionHtml,
        descriptionText: plainText(descriptionHtml),
        locationLabel: 'Lagos, Nigeria (demo)',
        country: 'NG',
        city: 'Lagos',
        workplace: 'onsite',
        category: 'Software engineering',
        skills: ['TypeScript', 'PostgreSQL'],
        applicationMethod: i === 2 ? 'external' : 'native',
        applyUrl: i === 2 ? 'https://example.com/demo-application' : null,
        status: 'active',
        isDemo: true,
        originalPostedAt: new Date('2026-10-01T00:00:00Z'),
        publishedAt: new Date(),
        lastVerifiedAt: new Date(),
        fingerprint: fingerprint(title, 'Lagos, Nigeria', plainText(descriptionHtml)),
      })
      .onConflictDoNothing();
  }
});
console.log(
  'DEMO ONLY: candidate@example.invalid, employer@example.invalid, admin@example.invalid',
);
console.log('Local fixture password: ' + password);
console.log('Never enable DEMO_MODE or use these credentials in production.');
await closeDb();

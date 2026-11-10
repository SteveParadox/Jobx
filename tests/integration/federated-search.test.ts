import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as s from '../../src/db/schema';
import { GET } from '../../src/app/api/platform/[...path]/route';
import { federatedSearch } from '../../src/domain/federated-search';
import { createEmployer, saveJob, transitionJob, verifyEmployer } from '../../src/domain/jobs';
import { requireActor } from '../../src/lib/auth';
import { AppError } from '../../src/lib/errors';
import { actor, jobInput, testDatabase } from '../helpers';

vi.mock('../../src/lib/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/auth')>()),
  requireActor: vi.fn(),
}));
vi.mock('../../src/lib/http', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/http')>()),
  rateLimit: vi.fn(async () => {}),
}));

let ctx: Awaited<ReturnType<typeof testDatabase>>;
const author = actor('multi-source-employer');
const candidate = actor('multi-source-candidate');
const root = actor('multi-source-admin', 'admin');
beforeAll(async () => { ctx = await testDatabase(); });
afterAll(async () => { await ctx.client.close(); });
beforeEach(async () => {
  await ctx.client.exec('TRUNCATE users, employers RESTART IDENTITY CASCADE');
  for (const person of [author, candidate, root]) await ctx.db.insert(s.user).values(person);
  vi.clearAllMocks();
  vi.mocked(requireActor).mockResolvedValue(candidate);
});
describe('federated search catalog boundary', () => {
  it('returns only published jobs and does not write searches, sources or applications', async () => {
    const employer = await createEmployer(author, {
      name: 'Verified fixture company', website: 'https://example.com',
    });
    await verifyEmployer(root, employer.id, 'verified', 'Test employer identity review');
    const pending = await saveJob(author, employer.id, {
      ...jobInput, title: 'Draft QA Specialist',
    });
    const published = await saveJob(author, employer.id, {
      ...jobInput, title: 'Backend Engineer',
    });
    await transitionJob(author, published.id, 'submit');
    await transitionJob(root, published.id, 'publish');
    const result = await federatedSearch({ q: 'Backend Engineer', provider: 'jobx' });
    expect(result.providers).toHaveLength(1);
    expect(result.providers[0].state).toBe('ok');
    expect(result.items.some((j) => j.id === 'jobx:' + published.id)).toBe(true);
    expect(result.items.some((j) => j.id === 'jobx:' + pending.id)).toBe(false);
    expect(await ctx.db.select().from(s.searchHistory)).toHaveLength(0);
    expect(await ctx.db.select().from(s.sources)).toHaveLength(0);
    expect(await ctx.db.select().from(s.applications)).toHaveLength(0);
  });
  it('requires a verified session for the multi-source API endpoint', async () => {
    const req = new Request('http://localhost:3000/api/platform/federated-search?q=nurse&provider=jobx');
    const context = { params: Promise.resolve({ path: ['federated-search'] }) };
    vi.mocked(requireActor).mockRejectedValueOnce(new AppError(401, 'Please sign in'));
    const unauthorized = await GET(req, context);
    expect(unauthorized.status).toBe(401);

    vi.mocked(requireActor).mockRejectedValueOnce(new AppError(403, 'Verify your email first'));
    const unverified = await GET(req, context);
    expect(unverified.status).toBe(403);

    const allowed = await GET(req, context);
    expect(allowed.status).toBe(200);
    expect((await allowed.json()).query.provider).toBe('jobx');
  });
  it('does not add any nationality or profession preference implicitly', async () => {
    const result = await federatedSearch({ q: 'warehouse', provider: 'jobx' });
    expect(result.query).toMatchObject({
      q: 'warehouse', provider: 'jobx', remoteOnly: 'false',
    });
    expect(result.query.country).toBeUndefined();
    expect(result.query.market).toBeUndefined();
  });
});

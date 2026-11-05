import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PATCH, POST } from '../../src/app/api/platform/[...path]/route';
import * as s from '../../src/db/schema';
import { crawlCareerSeed } from '../../src/domain/discovery/career-crawler';
import { runConfiguredSeedDiscovery } from '../../src/domain/discovery/discovery-service';
import { candidateFromUrl } from '../../src/domain/discovery/source-classifier';
import { enqueueSource, processIngestionTask } from '../../src/domain/ingestion-tasks';
import { transitionJob } from '../../src/domain/jobs';
import { searchJobs } from '../../src/domain/search';
import {
  changeSourceEnabled,
  reviewSource,
  updateSource,
} from '../../src/domain/source-management';
import { currentActor, requireActor } from '../../src/lib/auth';
import { actor, description } from '../helpers';
import { testPostgresDatabase } from '../postgres';

vi.mock('../../src/domain/discovery/career-crawler', async (original) => ({
  ...(await original<typeof import('../../src/domain/discovery/career-crawler')>()),
  crawlCareerSeed: vi.fn(),
}));
vi.mock('../../src/lib/auth', async (original) => ({
  ...(await original<typeof import('../../src/lib/auth')>()),
  currentActor: vi.fn(),
  requireActor: vi.fn(),
}));
vi.mock('../../src/lib/http', async (original) => ({
  ...(await original<typeof import('../../src/lib/http')>()),
  rateLimit: vi.fn(async () => {}),
}));

const root = actor('discovery-root', 'admin');
const seed = 'https://boards.greenhouse.io/discovery-fixture';
async function request(path: string, method: 'POST' | 'PATCH', data: unknown) {
  return { POST, PATCH }[method](
    new Request('http://localhost:3000/api/platform/' + path, {
      method,
      headers: { Origin: 'http://localhost:3000', 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }),
    { params: Promise.resolve({ path: path.split('/') }) },
  );
}

describe.runIf(Boolean(process.env.TEST_POSTGRES_URL))('PostgreSQL discovery lifecycle', () => {
  let ctx: Awaited<ReturnType<typeof testPostgresDatabase>>;
  let employerId: string;
  beforeAll(async () => {
    ctx = await testPostgresDatabase(process.env.TEST_POSTGRES_URL!);
  });
  afterAll(async () => {
    await ctx?.client.close();
  });
  beforeEach(async () => {
    await ctx.client.exec(
      'TRUNCATE users, employers, discovery_runs, discovery_candidates, source_host_budgets RESTART IDENTITY CASCADE',
    );
    await ctx.db.insert(s.user).values(root);
    const [employer] = await ctx.db
      .insert(s.employers)
      .values({
        name: 'Discovery lifecycle fixture',
        slug: 'discovery-lifecycle-fixture',
        website: 'https://careers.example.com',
        verificationStatus: 'verified',
      })
      .returning();
    employerId = employer.id;
    vi.clearAllMocks();
    vi.mocked(currentActor).mockResolvedValue(root);
    vi.mocked(requireActor).mockResolvedValue(root);
    vi.mocked(crawlCareerSeed).mockResolvedValue([candidateFromUrl(seed, 'seed_domain')]);
  });

  it('retains reviews on rescan and requires approval, source test and moderation before public search', async () => {
    expect((await request('admin/discovery/run', 'POST', { seeds: seed })).status).toBe(200);
    const [candidate] = await ctx.db.select().from(s.discoveryCandidates);
    const path = 'admin/discovery/' + candidate.id;
    expect(
      (
        await request(path, 'PATCH', {
          state: 'IDENTIFIED',
          note: 'Fixture review without an employer.',
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await request(path, 'PATCH', {
          state: 'IDENTIFIED',
          employerId,
          note: 'Verified fixture identity; separate permission review required.',
        })
      ).status,
    ).toBe(200);
    await runConfiguredSeedDiscovery(seed, 15, new Date(), true);
    expect((await ctx.db.select().from(s.discoveryCandidates))[0]).toMatchObject({
      state: 'IDENTIFIED',
      employerId,
    });
    const draft = await request(path + '/source-draft', 'POST', {
      employerId,
      permissionEvidence: 'Explicit fictional fixture permission, no live source rights.',
      attribution: 'Discovery fixture',
      permittedFields: ['title', 'description', 'location', 'application'],
      removalPolicy: 'Remove fixture jobs after confirmed closure.',
      applicationHostnames: ['careers.example.com'],
      usageConditions: 'Controlled test fixture use only; no real redistribution rights.',
      intervalMinutes: 60,
      // Unknown client-supplied flags must never grant approval or publication.
      enabled: true,
      autoPublish: true,
      approvalStatus: 'approved',
    });
    expect(draft.status).toBe(200);
    const { source } = await draft.json();
    expect(source).toMatchObject({ enabled: false, autoPublish: false, approvalStatus: 'pending' });
    await expect(enqueueSource(root, source.id)).rejects.toMatchObject({ code: 'NOT_APPROVED' });
    expect((await searchJobs({})).total).toBe(0);
    // Greenhouse supplies display text, so map the verified fixture location explicitly.
    await updateSource(root, source.id, {
      ...source,
      config: {
        locationOverrides: {
          'Lagos, Nigeria': { country: 'NG', city: 'Lagos', workplace: 'onsite' },
        },
      },
    });
    await reviewSource(
      root,
      source.id,
      'approved',
      'Explicit recorded fixture contract and employer approval.',
    );
    await expect(changeSourceEnabled(root.id, source.id, true)).rejects.toMatchObject({
      status: 409,
    });
    const options = {
      pace: async () => {},
      transport: async (url: string) => ({
        url,
        status: 200,
        headers: new Headers({
          'content-type': url.endsWith('/robots.txt') ? 'text/plain' : 'application/json',
        }),
        body: url.endsWith('/robots.txt')
          ? 'User-agent: *\nAllow: /'
          : JSON.stringify({
              jobs: [
                {
                  id: 1001,
                  title: 'Discovery Fixture Engineer',
                  absolute_url: 'https://careers.example.com/jobs/1001',
                  content: description,
                  location: { name: 'Lagos, Nigeria' },
                },
              ],
            }),
      }),
    };
    const test = await enqueueSource(root, source.id, 'test');
    await processIngestionTask(test.taskId, options);
    expect(await ctx.db.select().from(s.jobs)).toHaveLength(0);
    await changeSourceEnabled(root.id, source.id, true);
    const sync = await enqueueSource(root, source.id);
    await processIngestionTask(sync.taskId, options);
    const [job] = await ctx.db.select().from(s.jobs);
    expect(job.status).toBe('pending');
    expect((await searchJobs({})).total).toBe(0);
    await transitionJob(root, job.id, 'publish');
    expect((await searchJobs({ q: 'Discovery Fixture' })).total).toBe(1);
  });

  it('records failed seeds as failed runs and retries on the next tick', async () => {
    vi.mocked(crawlCareerSeed).mockRejectedValueOnce(new Error('Fixture network outage'));
    expect(await runConfiguredSeedDiscovery(seed, 60)).toMatchObject({
      status: 'failed',
      rejected: 1,
    });
    expect((await ctx.db.select().from(s.discoveryRuns))[0].status).toBe('failed');
    expect(await runConfiguredSeedDiscovery(seed, 60)).toMatchObject({
      status: 'completed',
      candidatesFound: 1,
    });
  });

  it('fences stale workers after recovery and keeps the recovered failure intact', async () => {
    let resume!: (value: Awaited<ReturnType<typeof crawlCareerSeed>>) => void;
    vi.mocked(crawlCareerSeed).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resume = resolve;
        }),
    );
    const old = runConfiguredSeedDiscovery(seed, 15);
    const oldAssertion = expect(old).rejects.toThrow('no longer active');
    await vi.waitFor(() => expect(resume).toBeDefined());
    const [run] = await ctx.db.select().from(s.discoveryRuns);
    await ctx.db
      .update(s.discoveryRuns)
      .set({ startedAt: new Date(Date.now() - 31 * 60_000) })
      .where(eq(s.discoveryRuns.id, run.id));
    vi.mocked(crawlCareerSeed).mockResolvedValueOnce([]);
    expect(await runConfiguredSeedDiscovery(seed, 15)).toMatchObject({ status: 'completed' });
    resume([candidateFromUrl(seed)]);
    await oldAssertion;
    expect(await ctx.db.select().from(s.discoveryCandidates)).toHaveLength(0);
    expect(
      (await ctx.db.select().from(s.discoveryRuns).where(eq(s.discoveryRuns.id, run.id)))[0],
    ).toMatchObject({
      status: 'failed',
      error: 'Discovery run exceeded the 30-minute safety window',
    });
  });

  it('denies discovery administration to a non-admin', async () => {
    vi.mocked(requireActor).mockResolvedValue(actor('ordinary-user'));
    expect((await request('admin/discovery/run', 'POST', { seeds: seed })).status).toBe(403);
    expect(crawlCareerSeed).not.toHaveBeenCalled();
  });
});

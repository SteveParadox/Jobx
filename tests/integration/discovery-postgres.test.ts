import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as s from '../../src/db/schema';
import { reserveHostRequestSlot } from '../../src/domain/discovery/career-crawler';
import { runConfiguredSeedDiscovery } from '../../src/domain/discovery/discovery-service';
import { assertReviewedCandidateCurrent } from '../../src/domain/discovery/review-guard';
import { registerSource } from '../../src/domain/source-management';
import { testPostgresDatabase } from '../postgres';

// These tests deliberately require real PostgreSQL connections. PGlite cannot
// validate cross-connection row locks or PostgreSQL upsert contention reliably.
describe.runIf(Boolean(process.env.TEST_POSTGRES_URL))(
  'PostgreSQL discovery concurrency guards',
  () => {
    let ctx: Awaited<ReturnType<typeof testPostgresDatabase>>;

    beforeAll(async () => {
      ctx = await testPostgresDatabase(process.env.TEST_POSTGRES_URL!);
    });

    afterAll(async () => {
      await ctx?.client.close();
    });

    beforeEach(async () => {
      await ctx.client.exec(
        'TRUNCATE discovery_candidates, source_host_budgets, employers RESTART IDENTITY CASCADE',
      );
    });

    it(
      'assigns unique, ordered request slots when workers reserve one hostname concurrently',
      async () => {
        const base = new Date('2026-10-25T12:00:00.000Z');
        const slots = await Promise.all(
          Array.from({ length: 8 }, () => reserveHostRequestSlot('careers.example.com', base)),
        );
        const ordered = slots.map((slot) => slot.getTime()).sort((a, b) => a - b);

        expect(new Set(ordered).size).toBe(ordered.length);
        for (let index = 1; index < ordered.length; index++) {
          expect(ordered[index] - ordered[index - 1]).toBeGreaterThanOrEqual(1000);
        }

        const [budget] = await ctx.db.select().from(s.sourceHostBudgets);
        expect(budget.hostname).toBe('careers.example.com');
        expect(budget.nextRequestAt.getTime()).toBe(ordered.at(-1));
      },
    );

    it(
      'rejects source-draft validation if a candidate review changes while the guard waits for its row lock',
      async () => {
        const [employer] = await ctx.db
          .insert(s.employers)
          .values({
            name: 'Discovery fixture employer',
            slug: 'discovery-fixture-employer',
            website: 'https://careers.example.com',
            verificationStatus: 'verified',
          })
          .returning({ id: s.employers.id });
        const [candidate] = await ctx.db
          .insert(s.discoveryCandidates)
          .values({
            canonicalUrl: 'https://boards.greenhouse.io/fixture',
            hostname: 'boards.greenhouse.io',
            provider: 'greenhouse',
            boardToken: 'fixture',
            state: 'IDENTIFIED',
            employerId: employer.id,
            reviewedAt: new Date(),
            requiresPermissionReview: true,
            evidence: [],
          })
          .returning({ id: s.discoveryCandidates.id });

        const holder = await ctx.pool.connect();
        await holder.query('BEGIN');
        try {
          await holder.query(
            'SELECT id FROM discovery_candidates WHERE id = $1 FOR UPDATE',
            [candidate.id],
          );
          const guard = ctx.db.transaction((tx) =>
            assertReviewedCandidateCurrent(tx, {
              id: candidate.id,
              employerId: employer.id,
              provider: 'greenhouse',
              boardToken: 'fixture',
            }),
          );

          await vi.waitFor(
            async () => {
              const { rows } = await ctx.pool.query(
                `SELECT pid FROM pg_stat_activity
                 WHERE application_name = $1
                   AND wait_event_type = 'Lock'
                   AND query ILIKE '%discovery_candidates%'`,
                [ctx.applicationName],
              );
              expect(rows.length).toBeGreaterThan(0);
            },
            { timeout: 3000, interval: 20 },
          );

          await holder.query(
            `UPDATE discovery_candidates
             SET state = 'REVIEW_REQUIRED', employer_id = NULL, reviewed_at = NULL
             WHERE id = $1`,
            [candidate.id],
          );
          await holder.query('COMMIT');
          await expect(guard).rejects.toMatchObject({ status: 409 });
        } finally {
          try {
            await holder.query('ROLLBACK');
          } finally {
            holder.release();
          }
        }
      },
    );
    it(
      'rejects source-draft validation if employer verification changes while the guard waits for its row lock',
      async () => {
        const [employer] = await ctx.db
          .insert(s.employers)
          .values({
            name: 'Employer race fixture',
            slug: 'employer-race-fixture',
            website: 'https://careers.example.com',
            verificationStatus: 'verified',
          })
          .returning({ id: s.employers.id });
        const [candidate] = await ctx.db
          .insert(s.discoveryCandidates)
          .values({
            canonicalUrl: 'https://boards.greenhouse.io/employer-race',
            hostname: 'boards.greenhouse.io',
            provider: 'greenhouse',
            boardToken: 'employer-race',
            state: 'IDENTIFIED',
            employerId: employer.id,
            reviewedAt: new Date(),
            requiresPermissionReview: true,
            evidence: [],
          })
          .returning({ id: s.discoveryCandidates.id });

        const holder = await ctx.pool.connect();
        await holder.query('BEGIN');
        try {
          await holder.query('SELECT id FROM employers WHERE id = $1 FOR UPDATE', [employer.id]);
          const guard = ctx.db.transaction((tx) =>
            assertReviewedCandidateCurrent(tx, {
              id: candidate.id,
              employerId: employer.id,
              provider: 'greenhouse',
              boardToken: 'employer-race',
            }),
          );

          await vi.waitFor(
            async () => {
              const { rows } = await ctx.pool.query(
                `SELECT pid FROM pg_stat_activity
                 WHERE application_name = $1
                   AND wait_event_type = 'Lock'
                   AND query ILIKE '%employers%'`,
                [ctx.applicationName],
              );
              expect(rows.length).toBeGreaterThan(0);
            },
            { timeout: 3000, interval: 20 },
          );

          await holder.query(
            "UPDATE employers SET verification_status = 'pending' WHERE id = $1",
            [employer.id],
          );
          await holder.query('COMMIT');
          await expect(guard).rejects.toMatchObject({ status: 409 });
        } finally {
          try {
            await holder.query('ROLLBACK');
          } finally {
            holder.release();
          }
        }
      },
    );
    it('creates a disabled, pending source draft only after revalidating the reviewed candidate and employer', async () => {
      const admin = {
        id: 'discovery-admin',
        name: 'Discovery Admin',
        email: 'discovery-admin@example.com',
        role: 'admin',
        emailVerified: true,
        disabled: false,
      };
      await ctx.db.insert(s.user).values(admin);
      const [employer] = await ctx.db
        .insert(s.employers)
        .values({
          name: 'Source draft fixture',
          slug: 'source-draft-fixture',
          website: 'https://careers.example.com',
          verificationStatus: 'verified',
        })
        .returning({ id: s.employers.id });
      const [candidate] = await ctx.db
        .insert(s.discoveryCandidates)
        .values({
          canonicalUrl: 'https://boards.greenhouse.io/draft-fixture',
          hostname: 'boards.greenhouse.io',
          provider: 'greenhouse',
          boardToken: 'draft-fixture',
          state: 'IDENTIFIED',
          employerId: employer.id,
          reviewedAt: new Date(),
          requiresPermissionReview: true,
          evidence: [],
        })
        .returning({ id: s.discoveryCandidates.id });

      const source = await registerSource(
        admin,
        {
          employerId: employer.id,
          provider: 'greenhouse',
          boardToken: 'draft-fixture',
          permissionEvidence: 'Explicit fixture authorization evidence for testing only.',
          attribution: 'Source draft fixture',
          permittedFields: ['title', 'description', 'location', 'application'],
          removalPolicy: 'Remove listings after confirmed source closure.',
          intervalMinutes: 60,
          applicationHostnames: ['careers.example.com'],
          usageConditions: 'Test fixture only; no real-world redistribution permission is implied.',
          autoPublish: false,
          enabled: false,
          config: {},
        },
        {
          action: 'discovery.source_draft_created',
          metadata: { candidateId: candidate.id, employerId: employer.id },
          validate: (tx) =>
            assertReviewedCandidateCurrent(tx, {
              id: candidate.id,
              employerId: employer.id,
              provider: 'greenhouse',
              boardToken: 'draft-fixture',
            }),
        },
      );

      expect(source.enabled).toBe(false);
      expect(source.autoPublish).toBe(false);
      expect(source.approvalStatus).toBe('pending');
      expect(source.employerId).toBe(employer.id);
    });
    it('recovers stale runs and removes host budgets older than the retention window', async () => {
      const now = new Date();
      const [staleRun] = await ctx.db
        .insert(s.discoveryRuns)
        .values({
          trigger: 'integration-fixture',
          status: 'running',
          seedsSeen: 1,
          startedAt: new Date(now.getTime() - 31 * 60_000),
        })
        .returning({ id: s.discoveryRuns.id });
      await ctx.db.insert(s.sourceHostBudgets).values({
        hostname: 'stale.example.com',
        nextRequestAt: new Date(now.getTime() - 31 * 24 * 60 * 60_000),
      });

      // localhost is rejected by public-IP validation before an HTTP request is sent.
      const result = await runConfiguredSeedDiscovery('https://localhost', 15, now);

      expect(result).toHaveProperty('runId');
      const [recovered] = await ctx.db
        .select({ status: s.discoveryRuns.status })
        .from(s.discoveryRuns)
        .where(eq(s.discoveryRuns.id, staleRun.id));
      expect(recovered.status).toBe('failed');
      const staleBudget = await ctx.db
        .select()
        .from(s.sourceHostBudgets)
        .where(eq(s.sourceHostBudgets.hostname, 'stale.example.com'));
      expect(staleBudget).toHaveLength(0);
    });
  },
);

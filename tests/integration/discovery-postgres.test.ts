import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as s from '../../src/db/schema';
import { reserveHostRequestSlot } from '../../src/domain/discovery/career-crawler';
import { assertReviewedCandidateCurrent } from '../../src/domain/discovery/review-guard';
import { testPostgresDatabase } from '../postgres';

// These tests deliberately require real PostgreSQL connections. PGlite cannot
// validate cross-connection row locks or PostgreSQL upsert contention reliably.
describe.runIf(Boolean(process.env.TEST_POSTGRES_URL))('PostgreSQL discovery concurrency guards', () => {
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

  it('assigns unique, ordered request slots when workers reserve one hostname concurrently', async () => {
    const base = new Date('2026-10-25T12:00:00.000Z');
    const slots = await Promise.all(
      Array.from({ length: 8 }, () => reserveHostRequestSlot('careers.example.com', base)),
    );
    const ordered = slots.map((slot) => slot.getTime()).sort((a, b) => a - b);

    expect(new Set(ordered).size).toBe(ordered.length);
    for (let index = 1; index < ordered.length; index++) {
      expect(ordered[index] - ordered[index - 1]).toBeGreaterThanOrEqual(1000);
    }

    const [budget] = await ctx.db
      .select()
      .from(s.sourceHostBudgets);
    expect(budget.hostname).toBe('careers.example.com');
    expect(budget.nextRequestAt.getTime()).toBe(ordered.at(-1));
  });

  it('rejects source-draft validation if a candidate review changes while the guard waits for its row lock', async () => {
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
      await holder.query('SELECT id FROM discovery_candidates WHERE id = $1 FOR UPDATE', [candidate.id]);
      const guard = ctx.db.transaction((tx) =>
        assertReviewedCandidateCurrent(tx, {
          id: candidate.id,
          employerId: employer.id,
          provider: 'greenhouse',
          boardToken: 'fixture',
        }),
      );

      await vi.waitFor(async () => {
        const { rows } = await ctx.pool.query(
          `SELECT pid FROM pg_stat_activity
           WHERE application_name = $1
             AND wait_event_type = 'Lock'
             AND query ILIKE '%discovery_candidates%'`,
          [ctx.applicationName],
        );
        expect(rows.length).toBeGreaterThan(0);
      }, { timeout: 3000, interval: 20 });

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
  });
});

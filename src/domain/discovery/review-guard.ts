import * as s from '@/db/schema';
import { AppError } from '@/lib/errors';
import { eq } from 'drizzle-orm';
import type { Tx } from '../jobs';

/**
 * Revalidate the reviewed identity while holding the candidate row lock.
 * Call inside the same transaction that creates the source draft.
 */
export async function assertReviewedCandidateCurrent(
  tx: Tx,
  expected: {
    id: string;
    employerId: string;
    provider: string;
    boardToken: string;
  },
): Promise<void> {
  const [candidate] = await tx
    .select({
      id: s.discoveryCandidates.id,
      state: s.discoveryCandidates.state,
      reviewedAt: s.discoveryCandidates.reviewedAt,
      employerId: s.discoveryCandidates.employerId,
      provider: s.discoveryCandidates.provider,
      boardToken: s.discoveryCandidates.boardToken,
    })
    .from(s.discoveryCandidates)
    .where(eq(s.discoveryCandidates.id, expected.id))
    .for('update')
    .limit(1);

  if (
    !candidate ||
    candidate.state !== 'IDENTIFIED' ||
    !candidate.reviewedAt ||
    candidate.employerId !== expected.employerId ||
    candidate.provider !== expected.provider ||
    candidate.boardToken !== expected.boardToken
  ) {
    throw new AppError(
      409,
      'Discovery candidate review changed; reload and review it again before creating the source draft',
    );
  }
}

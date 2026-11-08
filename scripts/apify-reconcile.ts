import { and, desc, eq, isNull, lt, or } from 'drizzle-orm';
import { closeDb, getDb } from '../src/db';
import * as s from '../src/db/schema';

/**
 * Read-only, keyset-paginated inventory for possible historical Apify imports.
 * An unowned external listing is NOT proof of Apify provenance.
 */
try {
  const db = getDb();
  let cursor: { createdAt: Date; id: string } | null = null;
  let reviewed = 0;
  for (;;) {
    const base = and(
      isNull(s.jobs.sourceOwnerId),
      eq(s.jobs.applicationMethod, 'external'),
    );
    const rows = await db
      .select({
        jobId: s.jobs.id,
        title: s.jobs.title,
        applyUrl: s.jobs.applyUrl,
        employerId: s.jobs.employerId,
        employerName: s.employers.name,
        verificationStatus: s.employers.verificationStatus,
        status: s.jobs.status,
        createdAt: s.jobs.createdAt,
      })
      .from(s.jobs)
      .innerJoin(s.employers, eq(s.jobs.employerId, s.employers.id))
      .where(
        cursor
          ? and(
              base,
              or(
                lt(s.jobs.createdAt, cursor.createdAt),
                and(
                  eq(s.jobs.createdAt, cursor.createdAt),
                  lt(s.jobs.id, cursor.id),
                ),
              ),
            )
          : base,
      )
      .orderBy(desc(s.jobs.createdAt), desc(s.jobs.id))
      .limit(500);
    if (!rows.length) break;
    for (const row of rows) {
      console.log(
        JSON.stringify({
          classification: 'manual_review_required',
          confirmedApify: false,
          ...row,
        }),
      );
      reviewed++;
    }
    const last = rows[rows.length - 1];
    cursor = { createdAt: last.createdAt, id: last.jobId };
  }
  console.error(
    'Reviewed ' + reviewed +
      ' unowned external jobs. These are not necessarily Apify imports. No data changed.',
  );
} finally {
  await closeDb();
}

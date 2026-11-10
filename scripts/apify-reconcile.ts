import { and, asc, eq, gt, isNull } from 'drizzle-orm';
import { closeDb, getDb } from '../src/db';
import * as s from '../src/db/schema';

type InventoryRow = Pick<
  typeof s.jobs.$inferSelect,
  'title' | 'applyUrl' | 'employerId' | 'status' | 'createdAt'
> & {
  jobId: string;
  employerName: string;
  verificationStatus: string;
};

/**
 * Read-only, keyset-paginated inventory for possible historical Apify imports.
 * An unowned external listing is NOT proof of Apify provenance.
 */
try {
  const db = getDb();
  // UUID keyset avoids timestamp precision loss when Date truncates PG microseconds.
  let cursor: string | null = null;
  let reviewed = 0;
  for (;;) {

    const rows: InventoryRow[] = await db
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
        and(
          isNull(s.jobs.sourceOwnerId),
          eq(s.jobs.applicationMethod, 'external'),
          cursor ? gt(s.jobs.id, cursor) : undefined,
        ),
      )
      .orderBy(asc(s.jobs.id))
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
    cursor = last.jobId;
  }
  console.error(
    'Reviewed ' + reviewed +
      ' unowned external jobs. These are not necessarily Apify imports. No data changed.',
  );
} finally {
  await closeDb();
}

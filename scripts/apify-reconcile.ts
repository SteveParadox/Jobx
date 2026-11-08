import { and, desc, eq, isNull } from 'drizzle-orm';
import { closeDb, getDb } from '../src/db';
import * as s from '../src/db/schema';

/**
 * Conservative read-only audit: historical direct Apify jobs have no reliable
 * provider marker. Do not infer an ownership relationship from a URL or name.
 */
try {
  const db = getDb();
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
    .where(and(isNull(s.jobs.sourceOwnerId), eq(s.jobs.applicationMethod, 'external')))
    .orderBy(desc(s.jobs.createdAt))
    .limit(500);
  for (const row of rows) {
    console.log(
      JSON.stringify({
        classification: 'manual_review_required',
        confirmedApify: false,
        ...row,
      }),
    );
  }
  console.error(
    'Reviewed ' + rows.length +
      ' unowned external jobs (max 500). These are not necessarily Apify imports. No data changed.',
  );
} finally {
  await closeDb();
}

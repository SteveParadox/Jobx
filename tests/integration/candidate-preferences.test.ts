import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DELETE, PATCH, POST, PUT } from '../../src/app/api/platform/[...path]/route';
import * as s from '../../src/db/schema';
import {
  candidateDashboard,
  clearSearchHistory,
  createAlert,
  exportCandidateData,
  markAllNotificationsRead,
  markNotification,
  pruneSearchHistory,
  recordSearch,
  saveSearch,
  updateAlert,
  updateCandidatePreferences,
} from '../../src/domain/candidates';
import { createEmployer, saveJob, transitionJob, verifyEmployer } from '../../src/domain/jobs';
import { deliverNotification, generateDigests } from '../../src/domain/notifications';
import { currentActor, requireActor } from '../../src/lib/auth';
import { sendEmail } from '../../src/lib/email';
import { actor, jobInput, testDatabase } from '../helpers';

vi.mock('../../src/lib/email', () => ({ sendEmail: vi.fn(async () => 'provider-message-id') }));
vi.mock('../../src/lib/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/auth')>()),
  currentActor: vi.fn(),
  requireActor: vi.fn(),
}));
vi.mock('../../src/lib/http', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/http')>()),
  rateLimit: vi.fn(async () => {}),
}));
let ctx: Awaited<ReturnType<typeof testDatabase>>;
const candidate = actor('candidate');
const other = actor('other');
const admin = actor('root', 'admin');
beforeAll(async () => {
  ctx = await testDatabase();
});
afterAll(async () => {
  await ctx.client.close();
});
beforeEach(async () => {
  await ctx.client.exec('TRUNCATE users, employers RESTART IDENTITY CASCADE');
  for (const user of [candidate, other, admin]) await ctx.db.insert(s.user).values(user);
  vi.clearAllMocks();
  vi.mocked(currentActor).mockResolvedValue(candidate);
  vi.mocked(requireActor).mockResolvedValue(candidate);
  vi.mocked(sendEmail).mockResolvedValue('provider-message-id');
});
const preferences = (enabled = true, email = true) =>
  updateCandidatePreferences(candidate, {
    searchHistoryEnabled: enabled,
    emailAlertsEnabled: email,
  });
const alert = (channel = 'email') =>
  createAlert(candidate, {
    name: 'My backend alert',
    filters: { q: 'backend' },
    frequency: 'daily',
    channel,
    consent: true,
  });
async function publish() {
  const employer = await createEmployer(other, {
    name: 'Explicit fixture employer',
    website: 'https://example.com',
  });
  await verifyEmployer(
    admin,
    employer.id,
    'verified',
    'Fixture permission and verification evidence for tests.',
  );
  const job = await saveJob(other, employer.id, jobInput);
  await transitionJob(other, job.id, 'submit');
  return transitionJob(admin, job.id, 'publish');
}
async function request(
  path: string,
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  data?: unknown,
  origin = 'http://localhost:3000',
) {
  const req = new Request('http://localhost:3000/api/platform/' + path, {
    method,
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  });
  return { POST, PUT, PATCH, DELETE }[method](req, {
    params: Promise.resolve({ path: path.split('/') }),
  });
}
describe('optional candidate search history', () => {
  it('does not record searches until the account explicitly opts in', async () => {
    expect((await candidateDashboard(candidate)).preferences.searchHistoryEnabled).toBe(false);
    expect(await recordSearch(candidate, { q: 'backend' })).toEqual({ recorded: false });
    expect(await ctx.db.select().from(s.searchHistory)).toHaveLength(0);
    expect((await preferences()).historyConsentedAt).toBeInstanceOf(Date);
    expect(await recordSearch(candidate, { q: 'backend' })).toEqual({ recorded: true });
    expect((await candidateDashboard(candidate)).history).toHaveLength(1);
  });
  it('deduplicates criteria across page, sorting, property order and case', async () => {
    await preferences();
    await recordSearch(candidate, { q: 'Backend', country: 'NG', page: 2 });
    await recordSearch(candidate, {
      country: 'ng',
      q: 'backend',
      sort: 'recent',
      tracking: 'ignored',
    });
    const [row] = await ctx.db.select().from(s.searchHistory);
    expect(await ctx.db.select().from(s.searchHistory)).toHaveLength(1);
    expect(row.filters).toEqual({ country: 'ng', q: 'backend' });
    expect(row.filters).not.toHaveProperty('page');
    expect(row.filters).not.toHaveProperty('tracking');
  });
  it('ignores empty searches and validates structured criteria', async () => {
    await preferences();
    expect(await recordSearch(candidate, { q: '  ', page: 3 })).toEqual({ recorded: false });
    await expect(recordSearch(candidate, { salaryMin: 1000 })).rejects.toThrow();
    expect(await ctx.db.select().from(s.searchHistory)).toHaveLength(0);
  });
  it('bounds each account to its 50 most recent distinct searches', async () => {
    await preferences();
    for (let i = 0; i < 53; i++) await recordSearch(candidate, { q: 'role ' + i });
    const history = (await candidateDashboard(candidate)).history;
    expect(history).toHaveLength(50);
    expect(history[0].filters).toEqual({ q: 'role 52' });
    expect(history.some((row) => (row.filters as { q: string }).q === 'role 0')).toBe(false);
  });
  it('hides and prunes history older than 90 days', async () => {
    await preferences();
    await recordSearch(candidate, { q: 'old query' });
    await ctx.db.update(s.searchHistory).set({ lastUsedAt: new Date(Date.now() - 91 * 86400000) });
    expect((await candidateDashboard(candidate)).history).toHaveLength(0);
    await pruneSearchHistory();
    expect(await ctx.db.select().from(s.searchHistory)).toHaveLength(0);
  });
  it('deletes history when disabled and rejects later background recordings', async () => {
    await preferences();
    await recordSearch(candidate, { q: 'backend' });
    await Promise.all([recordSearch(candidate, { q: 'frontend' }), preferences(false)]);
    expect((await candidateDashboard(candidate)).history).toHaveLength(0);
    expect(await recordSearch(candidate, { q: 'backend' })).toEqual({ recorded: false });
    expect((await candidateDashboard(candidate)).preferences.historyConsentedAt).toBeNull();
    const logs = await ctx.db.select().from(s.auditLogs);
    expect(JSON.stringify(logs)).not.toContain('frontend');
  });
  it('isolates individual deletion, clearing and exports by account', async () => {
    await preferences();
    await updateCandidatePreferences(other, {
      searchHistoryEnabled: true,
      emailAlertsEnabled: true,
    });
    await recordSearch(candidate, { q: 'my search' });
    await recordSearch(other, { q: 'private other search' });
    const row = (await candidateDashboard(other)).history[0];
    await expect(clearSearchHistory(candidate, row.id)).rejects.toMatchObject({ status: 404 });
    expect(JSON.stringify(await exportCandidateData(candidate))).not.toContain(
      'private other search',
    );
    expect((await exportCandidateData(candidate)).history).toHaveLength(1);
    await clearSearchHistory(candidate);
    expect((await candidateDashboard(candidate)).history).toHaveLength(0);
    expect((await candidateDashboard(other)).history).toHaveLength(1);
  });
  it('allows anonymous search without creating history and enforces origin on mutations', async () => {
    vi.mocked(currentActor).mockResolvedValue(null);
    const anonymous = await request('search-history', 'POST', { q: 'backend' });
    expect(await anonymous.json()).toEqual({ recorded: false });
    expect(
      (
        await request(
          'preferences',
          'PUT',
          {
            searchHistoryEnabled: true,
            emailAlertsEnabled: true,
          },
          'https://attacker.example',
        )
      ).status,
    ).toBe(403);
    expect(await ctx.db.select().from(s.candidatePreferences)).toHaveLength(0);
  });
  it('erases history and preferences through the account deletion workflow', async () => {
    await preferences();
    await recordSearch(candidate, { q: 'backend' });
    const result = await request('account/delete', 'POST', { confirmation: 'DELETE' });
    expect(result.status).toBe(200);
    expect(await ctx.db.select().from(s.searchHistory)).toHaveLength(0);
    expect(await ctx.db.select().from(s.candidatePreferences)).toHaveLength(0);
    expect(await recordSearch(candidate, { q: 'late request' })).toEqual({ recorded: false });
  });
});
describe('candidate alert and notification controls', () => {
  it('edits a saved search without retaining a stale page number', async () => {
    const saved = await saveSearch(candidate, 'Original', { q: 'backend', page: 5 });
    expect(saved.filters).toMatchObject({ page: 1 });
    await expect(saveSearch(other, 'Stolen', {}, saved.id)).rejects.toMatchObject({ status: 404 });
    const response = await request('saved-searches/' + saved.id, 'PATCH', {
      name: 'Remote jobs',
      filters: { workplace: 'remote', eligibleCountry: 'NG', page: 3 },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      name: 'Remote jobs',
      filters: { page: 1, eligibleCountry: 'NG' },
    });
  });
  it('requires fresh consent for new alert criteria and resuming, but not pausing', async () => {
    const a = await alert();
    await expect(
      updateAlert(candidate, a.id, { filters: { q: 'frontend' } }),
    ).rejects.toMatchObject({ status: 400 });
    await updateAlert(candidate, a.id, { enabled: false });
    await expect(updateAlert(candidate, a.id, { enabled: true })).rejects.toMatchObject({
      status: 400,
    });
    await updateAlert(candidate, a.id, {
      filters: { q: 'frontend' },
      frequency: 'weekly',
      channel: 'in_app',
      enabled: true,
      consent: true,
    });
    const [stored] = await ctx.db.select().from(s.alerts);
    expect(stored).toMatchObject({
      enabled: true,
      frequency: 'weekly',
      channel: 'in_app',
      filters: { q: 'frontend', page: 1 },
    });
    await expect(updateAlert(other, a.id, { enabled: false })).rejects.toMatchObject({
      status: 404,
    });
  });
  it('cancels queued digests when an alert is edited or paused', async () => {
    const a = await alert();
    await publish();
    await generateDigests();
    const [d] = await ctx.db.select().from(s.deliveries);
    await updateAlert(candidate, a.id, { filters: { q: 'frontend' }, consent: true });
    await deliverNotification(d.id);
    expect((await ctx.db.select().from(s.deliveries))[0].status).toBe('cancelled');
    expect(sendEmail).not.toHaveBeenCalled();
  });
  it('preserves consent and queued matches when unchanged criteria are submitted with a frequency edit', async () => {
    const a = await alert();
    await publish();
    await generateDigests();
    const [before] = await ctx.db.select().from(s.alerts);
    await updateAlert(candidate, a.id, {
      filters: { q: 'BACKEND', page: 4, sort: 'recent' },
      frequency: 'weekly',
    });
    const [after] = await ctx.db.select().from(s.alerts);
    expect(after.consentedAt).toEqual(before.consentedAt);
    expect(after.lastRunAt).toEqual(before.lastRunAt);
    expect((await ctx.db.select().from(s.deliveries))[0].status).toBe('pending');
  });
  it('creates in-app matches without email and keeps already notified jobs deduplicated', async () => {
    const a = await alert('in_app');
    await publish();
    await generateDigests();
    expect(await ctx.db.select().from(s.deliveries)).toHaveLength(0);
    expect(await ctx.db.select().from(s.notifications)).toHaveLength(1);
    await updateAlert(candidate, a.id, { channel: 'email', consent: true });
    await generateDigests();
    expect(await ctx.db.select().from(s.deliveries)).toHaveLength(0);
    expect(await ctx.db.select().from(s.notifications)).toHaveLength(1);
  });
  it('stops all subscribed email digests but retains in-app updates when opted out', async () => {
    await alert();
    await publish();
    await preferences(false, false);
    await generateDigests();
    expect(await ctx.db.select().from(s.deliveries)).toHaveLength(0);
    expect(await ctx.db.select().from(s.notifications)).toHaveLength(1);
  });
  it('checks global preferences again before delivery and cancels queued email', async () => {
    await alert();
    await publish();
    await generateDigests();
    const [delivery] = await ctx.db.select().from(s.deliveries);
    // Directly insert a preference to prove delivery checks it, independently of cancellation in the settings service.
    await ctx.db
      .insert(s.candidatePreferences)
      .values({ userId: candidate.id, emailAlertsEnabled: false });
    await deliverNotification(delivery.id);
    expect(sendEmail).not.toHaveBeenCalled();
    expect((await ctx.db.select().from(s.deliveries))[0].status).toBe('cancelled');
  });
  it('cancels queued emails atomically when the global preference is turned off', async () => {
    await alert();
    await publish();
    await generateDigests();
    await preferences(false, false);
    expect((await ctx.db.select().from(s.deliveries))[0].status).toBe('cancelled');
    await preferences(false, true);
    const [d] = await ctx.db.select().from(s.deliveries);
    await deliverNotification(d.id);
    expect(sendEmail).not.toHaveBeenCalled();
  });
  it('allows read/unread controls only on the candidate’s own updates', async () => {
    const [own, theirs] = await ctx.db
      .insert(s.notifications)
      .values([
        { userId: candidate.id, title: 'Own update', body: 'Own', dedupeKey: 'own' },
        { userId: other.id, title: 'Other update', body: 'Private', dedupeKey: 'other' },
      ])
      .returning();
    await expect(markNotification(candidate, theirs.id, true)).rejects.toMatchObject({
      status: 404,
    });
    await markNotification(candidate, own.id, true);
    expect((await candidateDashboard(candidate)).notifications[0].readAt).toBeInstanceOf(Date);
    await markNotification(candidate, own.id, false);
    await markAllNotificationsRead(candidate);
    expect((await candidateDashboard(other)).notifications[0].readAt).toBeNull();
  });
  it('validates ownership and field types through the real route handler', async () => {
    const a = await alert();
    vi.mocked(requireActor).mockResolvedValue(other);
    expect((await request('alerts/' + a.id, 'PATCH', { enabled: false })).status).toBe(404);
    expect((await request('alerts/' + a.id, 'DELETE')).status).toBe(404);
    expect(
      (
        await request('preferences', 'PUT', {
          searchHistoryEnabled: 'true',
          emailAlertsEnabled: true,
        })
      ).status,
    ).toBe(400);
  });
});
describe('notification replay and delivery recovery', () => {
  async function pending() {
    await alert();
    await publish();
    await generateDigests();
    return (await ctx.db.select().from(s.deliveries))[0];
  }
  it('serializes duplicate worker claims and delivers once in the transaction harness', async () => {
    const d = await pending();
    await Promise.all([deliverNotification(d.id), deliverNotification(d.id)]);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect((await ctx.db.select().from(s.deliveries))[0]).toMatchObject({
      status: 'sent',
      attempts: 1,
    });
  });
  it('cancels stale recipients rather than changing the provider retry payload', async () => {
    const d = await pending();
    await ctx.db
      .update(s.user)
      .set({ email: 'changed@example.com' })
      .where(eq(s.user.id, candidate.id));
    await deliverNotification(d.id);
    expect(sendEmail).not.toHaveBeenCalled();
    expect((await ctx.db.select().from(s.deliveries))[0].status).toBe('cancelled');
  });
  it('persists failed attempts, retries with a stable provider key and records a successful send', async () => {
    const d = await pending();
    vi.mocked(sendEmail).mockRejectedValueOnce(new Error('Temporary provider failure'));
    await expect(deliverNotification(d.id)).rejects.toThrow('Temporary provider failure');
    const [failed] = await ctx.db.select().from(s.deliveries);
    expect(failed).toMatchObject({
      status: 'pending',
      attempts: 1,
      lastError: 'Temporary provider failure',
    });
    expect(failed.firstAttemptAt).toBeInstanceOf(Date);
    await deliverNotification(d.id);
    const [sent] = await ctx.db.select().from(s.deliveries);
    expect(sent).toMatchObject({ status: 'sent', attempts: 2, lastError: null });
    expect(sent.firstAttemptAt).toEqual(failed.firstAttemptAt);
    expect(vi.mocked(sendEmail).mock.calls.map((args) => args[3])).toEqual([
      d.dedupeKey,
      d.dedupeKey,
    ]);
  });
  it('requires review after a crash marker passes the provider idempotency window', async () => {
    const d = await pending();
    await ctx.db
      .update(s.deliveries)
      .set({ firstAttemptAt: new Date(Date.now() - 24 * 3600000), attempts: 0 });
    await deliverNotification(d.id);
    await deliverNotification(d.id);
    expect(sendEmail).not.toHaveBeenCalled();
    expect((await ctx.db.select().from(s.deliveries))[0].status).toBe('review');
  });
  it('escalates the fifth actual provider failure to manual review instead of leaving pending forever', async () => {
    const d = await pending();
    await ctx.db.update(s.deliveries).set({ attempts: 4, firstAttemptAt: new Date() })
      .where(eq(s.deliveries.id, d.id));
    vi.mocked(sendEmail).mockRejectedValueOnce(new Error('Provider still unavailable'));
    await expect(deliverNotification(d.id)).rejects.toThrow('Provider still unavailable');
    const [failed] = await ctx.db.select().from(s.deliveries);
    expect(failed).toMatchObject({
      status: 'review', attempts: 5, lastError: 'Provider still unavailable',
    });
    await deliverNotification(d.id);
    expect(vi.mocked(sendEmail)).toHaveBeenCalledTimes(1);
  });
  it('handles legacy ambiguous sends conservatively and respects the retry limit', async () => {
    const d = await pending();
    await ctx.db.update(s.alerts).set({ consentedAt: new Date(Date.now() - 48 * 3600000) });
    await ctx.db
      .update(s.deliveries)
      .set({ createdAt: new Date(Date.now() - 24 * 3600000), attempts: 1 });
    await deliverNotification(d.id);
    expect((await ctx.db.select().from(s.deliveries))[0].status).toBe('review');
    await ctx.db
      .update(s.deliveries)
      .set({ status: 'pending', attempts: 5, firstAttemptAt: new Date() })
      .where(and(eq(s.deliveries.id, d.id), eq(s.deliveries.userId, candidate.id)));
    await deliverNotification(d.id);
    expect(sendEmail).not.toHaveBeenCalled();
    expect((await ctx.db.select().from(s.deliveries))[0].lastError).toContain('retry limit');
  });
});

describe('durable private-object deletion', () => {
  it('commits résumé deletion commands together with account erasure without requiring S3 availability', async () => {
    await ctx.db.insert(s.resumes).values({
      userId: candidate.id,
      objectKey: 'resumes/candidate/123e4567-e89b-12d3-a456-426614174000.pdf',
      filename: 'profile.pdf',
      mime: 'application/pdf',
      bytes: 100,
      sha256: 'fixturehash',
      status: 'clean',
    });
    const response = await request('account/delete', 'POST', { confirmation: 'DELETE' });
    expect(response.status).toBe(200);
    expect((await ctx.db.select().from(s.user).where(eq(s.user.id, candidate.id)))[0].disabled).toBe(true);
    expect(await ctx.db.select().from(s.resumes)).toHaveLength(0);
    const cleanup = (await ctx.db.select().from(s.outbox)).filter((v) => v.topic === 'storage-delete');
    expect(cleanup).toHaveLength(1);
    expect(cleanup[0].payload).toEqual({
      objectKey: 'resumes/candidate/123e4567-e89b-12d3-a456-426614174000.pdf',
    });
  });
});

it('rejects a finished PDF upload after erasure and queues deletion of the orphan object', async () => {
  const { env } = await import('../../src/lib/config');
  const { S3Client } = await import('@aws-sdk/client-s3');
  const { uploadResume } = await import('../../src/integrations/storage');
  const original = {
    bucket: env.S3_BUCKET,
    key: env.S3_ACCESS_KEY_ID,
    secret: env.S3_SECRET_ACCESS_KEY,
  };
  Object.assign(env, {
    S3_BUCKET: 'test-private-documents',
    S3_ACCESS_KEY_ID: 'fixture-key',
    S3_SECRET_ACCESS_KEY: 'fixture-secret',
  });
  const send = vi.spyOn(S3Client.prototype, 'send').mockResolvedValue({} as never);
  try {
    await ctx.db.update(s.user).set({ disabled: true }).where(eq(s.user.id, candidate.id));
    await expect(uploadResume(
      candidate,
      Buffer.from('%PDF-1.7 fixture document'),
      'cv.pdf',
      'application/pdf',
    )).rejects.toMatchObject({ status: 409 });
    expect(await ctx.db.select().from(s.resumes)).toHaveLength(0);
    const cleanup = await ctx.db.select().from(s.outbox);
    expect(cleanup.some((row) =>
      row.topic === 'storage-delete' &&
      typeof (row.payload as { objectKey?: string })?.objectKey === 'string',
    )).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);
  } finally {
    send.mockRestore();
    Object.assign(env, {
      S3_BUCKET: original.bucket,
      S3_ACCESS_KEY_ID: original.key,
      S3_SECRET_ACCESS_KEY: original.secret,
    });
  }
});

it('refuses a mismatched queue payload before attempting private S3 deletion', async () => {
  const { deleteStoredResumeCommand } = await import('../../src/integrations/storage');
  const [row] = await ctx.db.insert(s.outbox).values({
    topic: 'storage-delete',
    payload: { objectKey: 'resumes/candidate/123e4567-e89b-12d3-a456-426614174000.pdf' },
    dedupeKey: 'storage-delete:test-mismatch',
  }).returning();
  await expect(deleteStoredResumeCommand(
    row.id,
    'resumes/candidate/123e4567-e89b-12d3-a456-426614174001.pdf',
  )).rejects.toThrow('does not match');
  const [pending] = await ctx.db.select().from(s.outbox).where(eq(s.outbox.id, row.id));
  expect(pending.dispatchedAt).toBeNull();
});

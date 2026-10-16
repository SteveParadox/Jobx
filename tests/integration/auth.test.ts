import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { POST as authRoute } from '../../src/app/api/auth/[...all]/route';
import * as s from '../../src/db/schema';
import { currentActor, getAuth } from '../../src/lib/auth';
import { testDatabase } from '../helpers';
vi.mock('../../src/lib/http', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/lib/http')>();
  return { ...original, rateLimit: vi.fn(async () => {}) };
});
const mail = vi.hoisted(() => ({
  messages: [] as { to: string; subject: string; html: string }[],
}));
vi.mock('../../src/lib/email', () => ({
  sendEmail: vi.fn(async (to: string, subject: string, html: string) => {
    mail.messages.push({ to, subject, html });
    return 'mock-email';
  }),
}));
let ctx: Awaited<ReturnType<typeof testDatabase>>;
beforeAll(async () => {
  ctx = await testDatabase();
});
afterAll(async () => {
  await ctx.client.close();
});
let requestCounter = 0;
function request(path: string, data: unknown) {
  return new Request('http://localhost:3000/api/auth/' + path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'http://localhost:3000',
      'x-forwarded-for': `198.51.100.${++requestCounter}`,
    },
    body: JSON.stringify(data),
  });
}
function lastLink() {
  const match = mail.messages.at(-1)?.html.match(/href="([^"]+)"/);
  expect(match).toBeTruthy();
  return match![1].replaceAll('&amp;', '&');
}
it('registers, verifies email, signs in and resolves a real session', async () => {
  const auth = getAuth();
  const response = await auth.handler(
    request('sign-up/email', {
      email: 'auth-fixture@example.com',
      password: 'secure-fixture-password-123',
      name: 'Auth Fixture',
      callbackURL: '/auth',
    }),
  );
  expect(response.status).toBe(200);
  expect(mail.messages.at(-1)?.subject).toBe('Verify your email');
  const denied = await auth.handler(
    request('sign-in/email', {
      email: 'auth-fixture@example.com',
      password: 'secure-fixture-password-123',
    }),
  );
  expect(denied.status).toBe(403);
  const verification = await auth.handler(new Request(lastLink()));
  expect([200, 302]).toContain(verification.status);
  const signedIn = await auth.handler(
    request('sign-in/email', {
      email: 'auth-fixture@example.com',
      password: 'secure-fixture-password-123',
    }),
  );
  expect(signedIn.status).toBe(200);
  const cookie = signedIn.headers.get('set-cookie');
  expect(cookie).toContain('HttpOnly');
  const req = new Request('http://localhost:3000/api/platform/me', {
    headers: { Cookie: cookie!.split(';')[0] },
  });
  const actor = await currentActor(req);
  expect(actor?.email).toBe('auth-fixture@example.com');
  expect(actor?.role).toBe('candidate');
  await ctx.db.update(s.user).set({ disabled: true }).where(eq(s.user.id, actor!.id));
  expect(await currentActor(req)).toBeNull();
  await ctx.db.update(s.user).set({ disabled: false }).where(eq(s.user.id, actor!.id));
  await ctx.db
    .update(s.session)
    .set({ expiresAt: new Date(Date.now() - 1000) })
    .where(eq(s.session.userId, actor!.id));
  expect(await currentActor(req)).toBeNull();
});
it('resets a password and revokes old sessions', async () => {
  const auth = getAuth();
  const reset = await auth.handler(
    request('request-password-reset', { email: 'auth-fixture@example.com', redirectTo: '/auth' }),
  );
  expect(reset.status).toBe(200);
  const resetLink = lastLink();
  expect(mail.messages.at(-1)?.subject).toBe('Reset your password');
  const redirected = await auth.handler(new Request(resetLink));
  expect(redirected.status).toBe(302);
  const destination = redirected.headers.get('location')!;
  const token = new URL(destination, 'http://localhost:3000').searchParams.get('token');
  expect(token).toBeTruthy();
  const result = await auth.handler(
    request('reset-password', { newPassword: 'new-secure-fixture-password-456', token }),
  );
  expect(result.status).toBe(200);
  expect(
    (
      await auth.handler(
        request('sign-in/email', {
          email: 'auth-fixture@example.com',
          password: 'secure-fixture-password-123',
        }),
      )
    ).status,
  ).not.toBe(200);
  expect(
    (
      await auth.handler(
        request('sign-in/email', {
          email: 'auth-fixture@example.com',
          password: 'new-secure-fixture-password-456',
        }),
      )
    ).status,
  ).toBe(200);
});
it('rejects cross-origin authentication mutations and privilege injection', async () => {
  const response = await authRoute(
    new Request('http://localhost:3000/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://attacker.example' },
      body: JSON.stringify({
        email: 'bad@example.com',
        password: 'secure-fixture-password-123',
        name: 'Bad',
        role: 'admin',
      }),
    }),
  );
  expect(response.status).toBe(403);
  const signUp = await getAuth().handler(
    request('sign-up/email', {
      email: 'role-fixture@example.com',
      password: 'secure-fixture-password-123',
      name: 'Role Fixture',
      role: 'admin',
      emailVerified: true,
    }),
  );
  expect(signUp.status).toBe(200);
  const [record] = await ctx.db
    .select()
    .from(s.user)
    .where(eq(s.user.email, 'role-fixture@example.com'));
  expect(record.role).toBe('candidate');
  expect(record.emailVerified).toBe(false);
});

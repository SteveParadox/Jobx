import { randomBytes, randomUUID } from 'node:crypto';
import { hashPassword } from 'better-auth/crypto';
import { eq } from 'drizzle-orm';
import { closeDb, getDb } from '../src/db';
import { account, auditLogs, user } from '../src/db/schema';
const email = process.argv[2]?.trim().toLowerCase();
if (!email) throw new Error('Usage: npm run admin:create -- admin@example.com');
const providedPassword = process.env.ADMIN_PASSWORD;
if (providedPassword !== undefined && providedPassword.length < 12)
  throw new Error('ADMIN_PASSWORD must be at least 12 characters');
const password = providedPassword ?? randomBytes(24).toString('base64url');
const db = getDb();
await db.transaction(async (tx) => {
  const [existing] = await tx.select().from(user).where(eq(user.email, email)).limit(1);
  const userId = existing?.id ?? randomUUID();
  if (existing) {
    await tx
      .update(user)
      .set({ role: 'admin', emailVerified: true, disabled: false, updatedAt: new Date() })
      .where(eq(user.id, userId));
  } else {
    await tx.insert(user).values({
      id: userId,
      name: 'Administrator',
      email,
      emailVerified: true,
      role: 'admin',
    });
  }
  const [credential] = await tx.select().from(account).where(eq(account.userId, userId)).limit(1);
  const hashedPassword = await hashPassword(password);
  if (credential) {
    if (credential.providerId !== 'credential')
      throw new Error('This account uses a social login and has no credential provider');
    await tx
      .update(account)
      .set({ password: hashedPassword, updatedAt: new Date() })
      .where(eq(account.id, credential.id));
  } else {
    await tx.insert(account).values({
      id: randomUUID(),
      accountId: userId,
      providerId: 'credential',
      userId,
      password: hashedPassword,
    });
  }
  await tx.insert(auditLogs).values({
    action: existing ? 'admin.credentials_set_by_operator' : 'admin.created_by_operator',
    entityId: userId,
    detail: { email },
  });
});
console.log(`Administrator account ready: ${email}`);
if (providedPassword === undefined) console.log(`Generated password: ${password}`);
console.log('Store the password securely; it will not be shown again.');
await closeDb();

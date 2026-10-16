import { eq } from 'drizzle-orm';
import { closeDb, getDb } from '../src/db';
import { auditLogs, user } from '../src/db/schema';
const email = process.argv[2];
if (!email) throw new Error('Usage: npm run admin:grant -- verified-admin@example.com');
await getDb().transaction(async (tx) => {
  const [actor] = await tx.select().from(user).where(eq(user.email, email));
  if (!actor || !actor.emailVerified) throw new Error('An existing verified user is required');
  await tx.update(user).set({ role: 'admin' }).where(eq(user.id, actor.id));
  await tx
    .insert(auditLogs)
    .values({ actorId: actor.id, action: 'admin.granted_by_operator', entityId: actor.id });
});
console.log('Administrator role granted to the verified account.');
await closeDb();

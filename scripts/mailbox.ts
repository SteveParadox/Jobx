import { desc, eq } from 'drizzle-orm';
import { closeDb, getDb } from '../src/db';
import { developmentEmails } from '../src/db/schema';
import { env } from '../src/lib/config';
if (!['development', 'test'].includes(env.APP_ENV))
  throw new Error('Development mailbox is not available in staging/production');
const recipient = process.argv[2];
if (!recipient) throw new Error('Usage: npx tsx scripts/mailbox.ts recipient@example.com');
const messages = await getDb()
  .select()
  .from(developmentEmails)
  .where(eq(developmentEmails.recipient, recipient))
  .orderBy(desc(developmentEmails.createdAt))
  .limit(5);
for (const m of messages) console.log(m.subject + '\n' + m.html);
await closeDb();

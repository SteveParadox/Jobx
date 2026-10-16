import { getDb } from '@/db';
import { settings } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { searchJobs } from './search';
import { searchSchema } from './validation';
export const landingSchema = z.object({
  title: z.string().min(10).max(160),
  description: z.string().min(50).max(300),
  bodyHtml: z.string().min(300).max(20000),
  filters: searchSchema,
  approved: z.boolean(),
});
export async function getLanding(path: string) {
  const [entry] = await getDb()
    .select()
    .from(settings)
    .where(eq(settings.key, 'landing:' + path));
  const value = landingSchema.safeParse(entry?.value);
  if (!value.success || !value.data.approved) return null;
  const inventory = await searchJobs(value.data.filters);
  if (inventory.total < 3) return null;
  return { ...value.data, updatedAt: entry.updatedAt };
}

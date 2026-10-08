import 'dotenv/config';
import { inArray, like } from 'drizzle-orm';
import { createDb } from '../../src/db/client';
import { extraJobs, settlementLines, workRecords } from '../../src/db/schema';

// Extra jobs saved by e2e runs carry order numbers starting with TF-E2E-. Remove them before a run so the
// shared dev database doesn't fill up with test jobs. (CI starts from an empty database each time.)
export default async function globalSetup() {
  if (!process.env.DATABASE_URL) return;
  const db = createDb();
  try {
    const jobs = await db.select({ id: extraJobs.id }).from(extraJobs).where(like(extraJobs.orderNumber, 'TF-E2E-%'));
    const ids = jobs.map((j) => j.id);
    if (ids.length) {
      await db.delete(settlementLines).where(inArray(settlementLines.extraJobId, ids));
      await db.delete(workRecords).where(inArray(workRecords.extraJobId, ids));
      await db.delete(extraJobs).where(inArray(extraJobs.id, ids));
    }
  } finally {
    await db.$client.end();
  }
}

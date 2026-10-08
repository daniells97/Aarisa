import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { and, eq } from 'drizzle-orm';
import { createDb } from '~/db/client';
import { drivers, workRecords } from '~/db/schema';
import { parseHovership } from '~/integrations/hovership';
import { SYSTEM_ACTOR } from '~/server/actor';
import { setBonus } from '~/server/hovership';

// Puts every Hovership bonus back to the value in the sample file (e2e left one changed).
const db = createDb();
const parsed = parseHovership(readFileSync('docs/seed/hovership_details_jun2026.csv', 'utf8'));
if (parsed.kind !== 'ok') throw new Error('parse');
let fixed = 0;
await db.transaction(async (tx) => {
  for (const r of parsed.rows) {
    const [d] = await tx.select().from(drivers).where(eq(drivers.hovershipCode, r.driverCode));
    const [w] = await tx.select().from(workRecords).where(and(eq(workRecords.driverId, d!.id), eq(workRecords.date, r.date), eq(workRecords.tier, 't1_3')));
    if (w && w.bonusCents !== r.bonusCents) { await setBonus(tx, SYSTEM_ACTOR, { driverId: d!.id, date: r.date, bonusCents: r.bonusCents }); fixed++; }
  }
});
console.log('bonuses restored:', fixed);
await db.$client.end();

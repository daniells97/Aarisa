import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { and, eq, isNull } from 'drizzle-orm';
import { createDb } from './client';
import { contractors, drivers, operations, rates, serviceTypes } from './schema';
import { CONTRACTORS, OPERATIONS, RATES, RATES_EFFECTIVE_FROM, SERVICE_TYPES } from './seed-data';
import { parseCsvObjects } from '~/integrations/csv';
import { audit, type AuditEntry } from '~/server/audit';

/** Idempotent: running twice inserts nothing new. Every insert is audited as `system`. */
export async function seedMasterData(database = createDb()) {
  await database.transaction(async (tx) => {
    const trail: AuditEntry[] = [];
    const log = (table: string, row: { id: string }) => trail.push({ table, recordId: row.id, action: 'insert', after: row, source: 'system' });

    const ops: Record<string, string> = {};
    for (const op of OPERATIONS) {
      const [row] = await tx.insert(operations).values(op).onConflictDoNothing().returning();
      if (row) log('operations', row);
      const [found] = await tx.select().from(operations).where(eq(operations.code, op.code));
      ops[op.code] = found!.id;
    }

    const services: Record<string, string> = {};
    for (const st of SERVICE_TYPES) {
      const { operation, ...rest } = st;
      const [row] = await tx.insert(serviceTypes).values({ ...rest, operationId: ops[operation]! }).onConflictDoNothing().returning();
      if (row) log('service_types', row);
      const [found] = await tx.select().from(serviceTypes)
        .where(and(eq(serviceTypes.operationId, ops[operation]!), eq(serviceTypes.code, st.code)));
      services[st.code] = found!.id;
    }

    for (const r of RATES) {
      const serviceTypeId = services[r.service]!;
      const existing = await tx.select({ id: rates.id }).from(rates).where(and(
        eq(rates.serviceTypeId, serviceTypeId),
        r.tier ? eq(rates.tier, r.tier) : isNull(rates.tier),
        isNull(rates.driverId), isNull(rates.contractorId),
        eq(rates.effectiveFrom, RATES_EFFECTIVE_FROM),
      ));
      if (existing.length) continue;
      const [row] = await tx.insert(rates).values({
        serviceTypeId, tier: r.tier, clientRateCents: r.client, driverRateCents: r.driver, effectiveFrom: RATES_EFFECTIVE_FROM,
      }).returning();
      log('rates', row!);
    }

    for (const name of CONTRACTORS) {
      const [row] = await tx.insert(contractors).values({ name }).onConflictDoNothing().returning();
      if (row) log('contractors', row);
    }

    // Drivers: one per Hovership code; take the first non-blank name seen for the code.
    const csv = readFileSync(new URL('../../docs/seed/hovership_details_jun2026.csv', import.meta.url), 'utf8');
    const byCode = new Map<string, string>();
    for (const rec of parseCsvObjects(csv).records) {
      const code = rec.driver_code!;
      if (code && rec.driver_name && !byCode.has(code)) byCode.set(code, rec.driver_name);
    }
    for (const [hovershipCode, fullName] of byCode) {
      const [row] = await tx.insert(drivers).values({ hovershipCode, fullName }).onConflictDoNothing().returning();
      if (row) log('drivers', row);
    }

    await audit(tx, trail);
    console.log(`Seed: ${trail.length} new rows (${byCode.size} drivers in the sample file)`);
  });
  return database;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const database = await seedMasterData();
  await database.$client.end();
}

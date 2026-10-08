import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { createDb } from './client';
import { contractors, dailyAssignments, drivers, operations, paymentsReceived, rates, routes, serviceTypes, settlementLines } from './schema';
import { CONTRACTORS, OPERATIONS, RATES, RATES_EFFECTIVE_FROM, SERVICE_TYPES } from './seed-data';
import { parseCsvObjects } from '~/integrations/csv';
import { audit, type AuditEntry } from '~/server/audit';
import { SYSTEM_ACTOR } from '~/server/actor';
import { importHovership } from '~/server/hovership';
import { setAssignment, setUnknownName } from '~/server/daily';
import { importTforce } from '~/server/tforce';
import { createExtraJob } from '~/server/extra-jobs';
import { recordPayment, refreshWeeklyLines } from '~/server/settlements';

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

/** Loads the June 2026 Hovership sample through the same import the portal uses. Skips if already loaded. */
export async function seedHovershipSample(database: ReturnType<typeof createDb>) {
  const text = readFileSync(new URL('../../docs/seed/hovership_details_jun2026.csv', import.meta.url), 'utf8');
  await database.transaction(async (tx) => {
    try {
      const out = await importHovership(tx, SYSTEM_ACTOR, { fileName: 'hovership_details_jun2026.csv', text });
      console.log(`Hovership sample: ${out.status}${'rows' in out ? `, ${out.rows} rows` : ''}`);
    } catch (e) {
      if ((e as { code?: string }).code === 'already_imported') console.log('Hovership sample: already loaded');
      else throw e;
    }
  });
}

/**
 * T-Force routes and the illustrative daily driver list for June 15 to 20 (docs/seed). Each route's
 * usual driver is whoever drove it most in the sample; 9000R and 9000S belong to Puma.
 */
export async function seedTforceSample(database: ReturnType<typeof createDb>) {
  const list = parseCsvObjects(readFileSync(new URL('../../docs/seed/tforce_daily_list_sample.csv', import.meta.url), 'utf8')).records;
  const pieces = parseCsvObjects(readFileSync(new URL('../../docs/seed/tforce_pieces_jun2026.csv', import.meta.url), 'utf8')).records;
  await database.transaction(async (tx) => {
    const [op] = await tx.select().from(operations).where(eq(operations.code, 'tforce'));
    const [puma] = await tx.select().from(contractors).where(eq(contractors.name, 'Puma'));
    const driverRows = await tx.select().from(drivers);
    const byName = new Map(driverRows.map((d) => [d.fullName, d.id]));
    const trail: AuditEntry[] = [];

    const codes = [...new Set([...list.map((r) => r.route!), ...pieces.map((r) => r.paid_driver!)])].sort();
    for (const code of codes) {
      const names = list.filter((r) => r.route === code).map((r) => r.driver_or_contractor!).filter(Boolean);
      const contractorRoute = names.some((n) => n.startsWith('CONTRACTOR:'));
      const counts = new Map<string, number>();
      for (const n of names) if (!n.startsWith('CONTRACTOR:')) counts.set(n, (counts.get(n) ?? 0) + 1);
      const usual = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
      const [row] = await tx.insert(routes).values({
        operationId: op!.id, code, contractorId: contractorRoute ? puma!.id : null, usualDriverId: !contractorRoute && usual ? byName.get(usual) ?? null : null,
      }).onConflictDoNothing().returning();
      if (row) trail.push({ table: 'routes', recordId: row.id, action: 'insert', after: row, source: 'system' });
    }
    await audit(tx, trail);

    const routeRows = await tx.select().from(routes).where(eq(routes.operationId, op!.id));
    const routeId = new Map(routeRows.map((r) => [r.code, r.id]));
    const existing = await tx.select({ id: dailyAssignments.id }).from(dailyAssignments).where(inArray(dailyAssignments.routeId, routeRows.map((r) => r.id))).limit(1);
    if (existing.length) return console.log('T-Force sample: daily list already loaded');
    for (const r of list) {
      const id = routeId.get(r.route!)!;
      const who = r.driver_or_contractor!;
      if (!who) await setUnknownName(tx, SYSTEM_ACTOR, { date: r.date!, routeId: id, rawName: r.raw_name! });
      else if (who.startsWith('CONTRACTOR:')) await setAssignment(tx, SYSTEM_ACTOR, { date: r.date!, routeId: id, payee: { contractorId: puma!.id } });
      else await setAssignment(tx, SYSTEM_ACTOR, { date: r.date!, routeId: id, payee: { driverId: byName.get(who)! } });
    }
    console.log(`T-Force sample: ${codes.length} routes, ${list.length} daily list entries`);
  });
  // T-Force's report for the same week, read through the normal import and weekly check.
  const text = readFileSync(new URL('../../docs/seed/tforce_pieces_jun2026.csv', import.meta.url), 'utf8');
  await database.transaction(async (tx) => {
    try {
      const out = await importTforce(tx, SYSTEM_ACTOR, { fileName: 'tforce_pieces_jun2026.csv', text });
      console.log(`T-Force report: ${out.status}${'openExceptions' in out ? `, ${out.rows} route-days, ${out.openExceptions} open exceptions` : ''}`);
    } catch (e) {
      if ((e as { code?: string }).code === 'already_imported') console.log('T-Force report: already loaded');
      else throw e;
    }
  });
}

/** Two illustrative extra jobs on June 18, as in the Mobile-Offline design (amounts are made up). */
export async function seedExtraJobs(database: ReturnType<typeof createDb>) {
  await database.transaction(async (tx) => {
    const [puma] = await tx.select().from(contractors).where(eq(contractors.name, 'Puma'));
    const [robert] = await tx.select().from(drivers).where(eq(drivers.fullName, 'Robert Arteaga'));
    const [r9000r] = await tx.select().from(routes).where(eq(routes.code, '9000R'));
    const a = await createExtraJob(tx, SYSTEM_ACTOR, {
      clientUuid: '6f0c1a52-5d0e-4c2f-9a51-000000000001', service: 'recovery_route', date: '2026-06-18', nearRouteId: r9000r!.id,
      payee: { contractorId: puma!.id }, clientAmountCents: 180_00, driverAmountCents: 120_00, orderNumber: 'TF-55821', note: null,
    });
    const b = await createExtraJob(tx, SYSTEM_ACTOR, {
      clientUuid: '6f0c1a52-5d0e-4c2f-9a51-000000000002', service: 'grainger', date: '2026-06-18', nearRouteId: null,
      payee: { driverId: robert!.id }, clientAmountCents: null, driverAmountCents: 40_00, orderNumber: null, note: null,
    });
    console.log(`Extra jobs: ${[a, b].filter((x) => x.created).length} new`);
  });
}

/** Expected lines for the loaded reports, and two illustrative Hovership payments (ACH) so the screen shows paid, late and open. */
export async function seedSettlements(database: ReturnType<typeof createDb>) {
  await database.transaction(async (tx) => {
    await refreshWeeklyLines(tx, SYSTEM_ACTOR, 'hovership');
    await refreshWeeklyLines(tx, SYSTEM_ACTOR, 'tforce');
    const [op] = await tx.select().from(operations).where(eq(operations.code, 'hovership'));
    const existing = await tx.select({ id: paymentsReceived.id }).from(paymentsReceived).where(eq(paymentsReceived.operationId, op!.id)).limit(1);
    if (existing.length) return console.log('Settlements: payments already loaded');
    const lines = await tx.select().from(settlementLines).where(and(eq(settlementLines.operationId, op!.id), eq(settlementLines.kind, 'hovership_invoice')));
    for (const [start, paidOn] of [['2026-06-01', '2026-06-26'], ['2026-06-08', '2026-07-02']] as const) {
      const line = lines.find((l) => l.periodStart === start);
      if (!line?.expectedCents) continue;
      await recordPayment(tx, SYSTEM_ACTOR, { operation: 'hovership', receivedOn: paidOn, amountCents: line.expectedCents, method: 'ACH', reference: `Sample ACH ${start}`, note: 'Illustrative sample payment', allocations: [{ lineId: line.id, amountCents: line.expectedCents }] });
    }
    console.log(`Settlements: ${lines.length} Hovership weeks, 2 sample payments`);
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const database = await seedMasterData();
  await seedHovershipSample(database);
  await seedTforceSample(database);
  await seedExtraJobs(database);
  await seedSettlements(database);
  await database.$client.end();
}

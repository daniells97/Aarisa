import { and, eq, inArray, lte, gte } from 'drizzle-orm';
import type { Tx } from '~/db/client';
import { drivers, operations, payPeriods, payrollRuns, rates, serviceTiers, serviceTypes } from '~/db/schema';
import type { RateFn } from '~/domain/hovership';
import { periodFor, type PayCycle } from '~/domain/periods';
import { rateFor, type RateRow } from '~/domain/rates';
import { RuleError } from './errors';

export async function getOperation(tx: Tx, code: 'hovership' | 'tforce') {
  const [op] = await tx.select().from(operations).where(eq(operations.code, code));
  if (!op) throw new RuleError('operation_missing');
  return { ...op, payCycle: op.payCycle as PayCycle };
}

export async function serviceIds(tx: Tx, operationId: string) {
  const rows = await tx.select().from(serviceTypes).where(eq(serviceTypes.operationId, operationId));
  return Object.fromEntries(rows.map((s) => [s.code, s.id])) as Record<string, string>;
}

/** Rate rows of some services, in the shape the rate rules read. */
export async function rateRows(tx: Tx, serviceTypeIds: string[]): Promise<RateRow[]> {
  if (!serviceTypeIds.length) return [];
  return tx.select({
    id: rates.id, serviceTypeId: rates.serviceTypeId, tierId: rates.tierId, payeeId: rates.payeeId,
    side: rates.side, rateCents: rates.rateCents, effectiveFrom: rates.effectiveFrom,
  }).from(rates).where(inArray(rates.serviceTypeId, serviceTypeIds));
}

/** Tiers of a service by code (T1, T2…), including retired ones that old records still use. */
export async function tierIdsByCode(tx: Tx, serviceTypeId: string) {
  const rows = await tx.select().from(serviceTiers).where(eq(serviceTiers.serviceTypeId, serviceTypeId));
  return new Map(rows.map((t) => [t.code, t.id]));
}

/**
 * Rate lookup for Hovership items (a package tier code, or `stat`), using the rate valid on each work
 * date and the driver's special rate when there is one. `t1_3` / `t4` are accepted for summed pieces.
 */
export async function hovershipRateFn(tx: Tx, operationId: string) {
  const ids = await serviceIds(tx, operationId);
  const rows = await rateRows(tx, Object.values(ids));
  const tiers = await tierIdsByCode(tx, ids.hovership_packages!);
  const payeeOf = new Map((await tx.select({ id: drivers.id, payeeId: drivers.payeeId }).from(drivers)).map((d) => [d.id, d.payeeId]));
  const legacy: Record<string, string> = { t1_3: 'T1-3', t4: 'T4' };
  const fn: RateFn = (item, driverId, date) => item === 'stat'
    ? rateFor(rows, ids.stat!, null, payeeOf.get(driverId) ?? null, date)
    : rateFor(rows, ids.hovership_packages!, tiers.get(legacy[item] ?? item) ?? null, payeeOf.get(driverId) ?? null, date);
  return { fn, rows, ids, tiers };
}

/** Rule 3: work inside an approved (or paid) payroll run can't change until the owner reopens it. */
export async function lockedPeriodStarts(tx: Tx, operationId: string, from: string, to: string) {
  const rows = await tx.select({ start: payPeriods.startDate, status: payrollRuns.status })
    .from(payPeriods).innerJoin(payrollRuns, eq(payrollRuns.payPeriodId, payPeriods.id))
    .where(and(eq(payPeriods.operationId, operationId), lte(payPeriods.startDate, to), gte(payPeriods.endDate, from)));
  return new Set(rows.filter((r) => r.status === 'approved' || r.status === 'paid').map((r) => r.start));
}

export async function assertNotLocked(tx: Tx, op: { id: string; cycleAnchor: string; payCycle: PayCycle }, date: string) {
  const p = periodFor(op.cycleAnchor, op.payCycle, date);
  const locked = await lockedPeriodStarts(tx, op.id, p.start, p.end);
  if (locked.has(p.start)) throw new RuleError('period_locked');
}

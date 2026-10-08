import { and, eq, inArray, lte, gte } from 'drizzle-orm';
import type { Tx } from '~/db/client';
import { operations, payPeriods, payrollRuns, rates, serviceTypes } from '~/db/schema';
import type { HovershipItem, RateFn } from '~/domain/hovership';
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

/** Rate lookup for Hovership items, using the rate valid on each work date. */
export async function hovershipRateFn(tx: Tx, operationId: string) {
  const ids = await serviceIds(tx, operationId);
  const rows = (await tx.select().from(rates).where(inArray(rates.serviceTypeId, Object.values(ids)))) as RateRow[];
  const service: Record<HovershipItem, string> = { t1_3: ids.hovership_packages!, t4: ids.hovership_packages!, stat: ids.stat! };
  const fn: RateFn = (item, driverId, date) => rateFor(rows, service[item], item === 'stat' ? null : item, { driverId }, date);
  return { fn, rows, ids };
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

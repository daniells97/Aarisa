import { and, asc, eq, inArray, lte, gte } from 'drizzle-orm';
import type { Tx } from '~/db/client';
import { operations, payPeriods, payrollRuns, rates, serviceTiers, serviceTypes } from '~/db/schema';
import { periodFor, type PayCycle } from '~/domain/periods';
import { type RateRow } from '~/domain/rates';
import { RuleError } from './errors';

export async function getOperation(tx: Tx, code: string) {
  const [op] = await tx.select().from(operations).where(eq(operations.code, code));
  if (!op) throw new RuleError('operation_missing');
  return { ...op, payCycle: op.payCycle as PayCycle };
}

export type Operation = Awaited<ReturnType<typeof getOperation>>;

export async function getOperationById(tx: Tx, id: string) {
  const [op] = await tx.select().from(operations).where(eq(operations.id, id));
  if (!op) throw new RuleError('operation_missing');
  return { ...op, payCycle: op.payCycle as PayCycle };
}

/** Active contracts, oldest first. */
export async function listOperations(tx: Tx) {
  return (await tx.select().from(operations).where(eq(operations.active, true)).orderBy(asc(operations.createdAt), asc(operations.code)))
    .map((op) => ({ ...op, payCycle: op.payCycle as PayCycle }));
}

/**
 * The contract a screen works on: the one asked for, else the first active one whose drivers come from
 * the given source (Today's drivers and extra jobs use the daily list; the weekly report the client report).
 */
export async function operationFor(tx: Tx, code: string | undefined, source: 'daily_list' | 'report_code') {
  if (code) return getOperation(tx, code);
  const op = (await listOperations(tx)).find((o) => o.driverSource === source);
  if (!op) throw new RuleError('operation_missing');
  return op;
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

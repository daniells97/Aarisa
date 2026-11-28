import { and, asc, desc, eq, gte, inArray, lt } from 'drizzle-orm';
import type { Tx } from '~/db/client';
import { adjustmentTypes, claims, exceptions, payAdjustments, payPeriods, routeExecutions, serviceTypes, settlementLines, workView } from '~/db/schema';
import { addDays, todayLA } from '~/domain/dates';
import { periodFor } from '~/domain/periods';
import { rateFor } from '~/domain/rates';
import { assertCan, type Actor } from './actor';
import { audit } from './audit';
import { RuleError } from './errors';
import { getOperationById, lockedPeriodStarts, type Operation } from './ops';
import { clientRate, valuationContext } from './valuation';

// Claims from the weekly check ("Ask T-Force") and their reconciliation. The owner decides every amount:
// what the payee is paid while the claim is open, what is claimed, and whether the payee gets anything
// more when the client answers. A payee correction for a closed week goes to the open pay period.

type ExceptionRow = typeof exceptions.$inferSelect;

/** The route-day the exception is about: its execution, the pieces reported and the rates that apply. */
export async function claimBasis(tx: Tx, ex: ExceptionRow) {
  const op = await getOperationById(tx, ex.operationId);
  const [exec] = ex.executionId
    ? await tx.select().from(routeExecutions).where(eq(routeExecutions.id, ex.executionId))
    : await tx.select().from(routeExecutions).where(and(eq(routeExecutions.operationId, op.id), eq(routeExecutions.date, ex.date), eq(routeExecutions.routeId, ex.routeId!), eq(routeExecutions.kind, 'route')));
  const day = exec ? await tx.select().from(workView).where(and(eq(workView.executionId, exec.id), eq(workView.source, 'client_report'))) : [];
  const reported = day.reduce((s, w) => s + w.pieces, 0);
  // The route's usual pieces: the last four weeks of the client's report for this route.
  const history = await tx.select().from(workView).where(and(eq(workView.operationId, op.id), eq(workView.routeId, ex.routeId!), eq(workView.source, 'client_report'),
    gte(workView.date, addDays(ex.date, -28)), lt(workView.date, ex.date))).orderBy(asc(workView.date));
  const d = (ex.details ?? {}) as { median?: number };
  const usual = d.median ?? median(history.map((h) => h.pieces));
  // Service and tier the pieces are paid at: the day's own record, else the route's last one, else the contract's first service.
  const sample = day[0] ?? history[history.length - 1];
  const serviceTypeId = sample?.serviceTypeId
    ?? (await tx.select({ id: serviceTypes.id }).from(serviceTypes).where(and(eq(serviceTypes.operationId, op.id), eq(serviceTypes.fromReport, true), eq(serviceTypes.active, true))).limit(1))[0]?.id ?? null;
  const tierId = sample?.tierId ?? null;
  const ctx = await valuationContext(tx, op.id);
  const payee = exec?.payeeId && serviceTypeId ? rateFor(ctx.rows, serviceTypeId, tierId, exec.payeeId, ex.date) : null;
  return {
    op, execution: exec ?? null, reported, usual,
    suggestedQuantity: Math.max(usual - reported, 0),
    clientRateCents: serviceTypeId ? clientRate(ctx, serviceTypeId, tierId, ex.date) : null,
    payeeRateCents: payee?.ok ? payee.driverCents : null,
  };
}

function median(xs: number[]) {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
}

async function correctionType(tx: Tx) {
  const [t] = await tx.select({ id: adjustmentTypes.id }).from(adjustmentTypes).where(eq(adjustmentTypes.code, 'correction'));
  if (!t) throw new Error('Adjustment type "correction" is missing');
  return t.id;
}

/**
 * Pays the payee `payQuantity` pieces for the exception's day instead of what the client reported: the
 * difference × the payee rate, as a correction on that day (its week is still open).
 */
export async function payQuantityFor(tx: Tx, actor: Actor, ex: ExceptionRow, basis: Awaited<ReturnType<typeof claimBasis>>, payQuantity: number, reason: string) {
  if (!Number.isInteger(payQuantity) || payQuantity < 0) throw new RuleError('invalid_quantity');
  const diff = payQuantity - basis.reported;
  if (diff === 0) return null;
  assertCan(actor, 'payroll.approve'); // paying other than what the client reported is the owner's call
  if (!basis.execution?.payeeId) throw new RuleError('no_payee');
  if (basis.payeeRateCents == null) throw new RuleError('missing_rate');
  const [row] = await tx.insert(payAdjustments).values({
    payeeId: basis.execution.payeeId, executionId: basis.execution.id, typeId: await correctionType(tx), amountCents: diff * basis.payeeRateCents,
    reason, status: 'confirmed', confirmedBy: actor.userId, confirmedAt: new Date(), createdBy: actor.userId,
  }).returning();
  await audit(tx, { table: 'pay_adjustments', recordId: row!.id, action: 'insert', after: row, userId: actor.userId, source: actor.source });
  return row!;
}

/** "Ask T-Force": a claim line in Settlements with what is claimed, and a draft claim that keeps why. */
export async function openClaim(tx: Tx, actor: Actor, ex: ExceptionRow, basis: Awaited<ReturnType<typeof claimBasis>>, input: { claimQuantity: number; claimCents: number | null; note: string | null; reference: string }) {
  // Without an amount (a dispatcher doesn't see client rates), the claim is the pieces × the client rate of that day.
  const claimCents = input.claimCents ?? (basis.clientRateCents != null ? input.claimQuantity * basis.clientRateCents : null);
  if (claimCents == null) throw new RuleError('missing_rate');
  if (!Number.isInteger(input.claimQuantity) || input.claimQuantity <= 0 || !Number.isInteger(claimCents) || claimCents <= 0) throw new RuleError('invalid_amount');
  const periodEnd = addDays(ex.periodStart, 6);
  const [line] = await tx.insert(settlementLines).values({
    operationId: basis.op.id, kind: 'claim_adjustment', reference: input.reference, periodStart: ex.periodStart, periodEnd,
    expectedCents: claimCents, expectedDate: addDays(periodEnd, basis.op.paymentTermsDays), status: 'claim_ready',
  }).returning();
  const [claim] = await tx.insert(claims).values({
    settlementLineId: line!.id, status: 'draft', exceptionId: ex.id, claimedQuantity: input.claimQuantity, claimedCents: claimCents,
    note: input.note, createdBy: actor.userId,
  }).returning();
  await audit(tx, [
    { table: 'settlement_lines', recordId: line!.id, action: 'insert', after: line, userId: actor.userId, source: actor.source },
    { table: 'claims', recordId: claim!.id, action: 'insert', after: claim, userId: actor.userId, source: actor.source },
  ]);
  return { line: line!, claim: claim! };
}

/** The first pay period of the contract, from today on, that is not approved yet: where late corrections are paid. */
async function openPayPeriod(tx: Tx, op: Operation, from: string) {
  let p = periodFor(op.cycleAnchor, op.payCycle, from);
  for (let i = 0; i < 12; i++) {
    if (!(await lockedPeriodStarts(tx, op.id, p.start, p.end)).has(p.start)) break;
    p = periodFor(op.cycleAnchor, op.payCycle, addDays(p.end, 1));
  }
  await tx.insert(payPeriods).values({ operationId: op.id, startDate: p.start, endDate: p.end }).onConflictDoNothing();
  const [row] = await tx.select().from(payPeriods).where(and(eq(payPeriods.operationId, op.id), eq(payPeriods.startDate, p.start)));
  return row!;
}

export interface ClaimResponseInput {
  response: 'accepted' | 'partial' | 'rejected';
  /** What the client agreed to pay; ignored when rejected. */
  acceptedCents: number | null;
  /** What the payee gets on top of what was already paid, decided by the owner; 0 or null = nothing. */
  payeeCents: number | null;
}

/**
 * Records the client's answer to a weekly-check claim. The line now expects what was accepted (nothing when
 * rejected). If the owner pays the payee something more, it is a correction in the open pay period.
 */
export async function respondToClaim(tx: Tx, actor: Actor, lineId: string, input: ClaimResponseInput) {
  assertCan(actor, 'settlements.record');
  if (input.payeeCents) assertCan(actor, 'payroll.approve'); // what a driver is paid is the owner's call
  const [line] = await tx.select().from(settlementLines).where(eq(settlementLines.id, lineId));
  if (!line || line.kind !== 'claim_adjustment') throw new RuleError('line_not_found');
  const [claim] = await tx.select().from(claims).where(eq(claims.settlementLineId, lineId)).orderBy(desc(claims.createdAt)).limit(1);
  if (!claim?.exceptionId) throw new RuleError('line_not_found');
  if (claim.response) throw new RuleError('already_resolved');
  const accepted = input.response === 'rejected' ? 0 : input.acceptedCents ?? 0;
  if (accepted < 0 || (input.response !== 'rejected' && accepted <= 0)) throw new RuleError('invalid_amount');
  if (input.payeeCents != null && (input.payeeCents < 0 || !Number.isInteger(input.payeeCents))) throw new RuleError('invalid_amount');

  let adjustmentId: string | null = null;
  if (input.payeeCents) {
    const [ex] = await tx.select().from(exceptions).where(eq(exceptions.id, claim.exceptionId));
    const basis = await claimBasis(tx, ex!);
    if (!basis.execution?.payeeId) throw new RuleError('no_payee');
    const period = await openPayPeriod(tx, basis.op, todayLA());
    const [adj] = await tx.insert(payAdjustments).values({
      payPeriodId: period.id, payeeId: basis.execution.payeeId, executionId: basis.execution.id, typeId: await correctionType(tx),
      amountCents: input.payeeCents, reason: `${line.reference ?? ''}: ${input.response}`.trim(), status: 'confirmed',
      confirmedBy: actor.userId, confirmedAt: new Date(), createdBy: actor.userId,
    }).returning();
    await audit(tx, { table: 'pay_adjustments', recordId: adj!.id, action: 'insert', after: adj, userId: actor.userId, source: actor.source });
    adjustmentId = adj!.id;
  }
  const [claimAfter] = await tx.update(claims).set({
    response: input.response, acceptedCents: accepted, respondedBy: actor.userId, respondedAt: new Date(), status: 'resolved', payAdjustmentId: adjustmentId,
  }).where(eq(claims.id, claim.id)).returning();
  const [lineAfter] = await tx.update(settlementLines).set({
    expectedCents: accepted, status: accepted === 0 ? 'paid' : line.status === 'paid' ? 'paid' : 'open', updatedAt: new Date(),
  }).where(eq(settlementLines.id, lineId)).returning();
  await audit(tx, [
    { table: 'claims', recordId: claim.id, action: 'update', before: claim, after: claimAfter, userId: actor.userId, source: actor.source },
    { table: 'settlement_lines', recordId: lineId, action: 'update', before: line, after: lineAfter, userId: actor.userId, source: actor.source },
  ]);
  return claimAfter!;
}

/** Corrections paid in a later period than their work (an accepted claim), per payee, for one period. */
export async function lateCorrections(tx: Tx, operationId: string, periodStart: string) {
  const [period] = await tx.select().from(payPeriods).where(and(eq(payPeriods.operationId, operationId), eq(payPeriods.startDate, periodStart)));
  if (!period) return [];
  return tx.select().from(payAdjustments).where(and(eq(payAdjustments.payPeriodId, period.id), eq(payAdjustments.status, 'confirmed')));
}

/** Claim details for Settlements lines, by line id. */
export async function claimsByLine(tx: Tx, lineIds: string[]) {
  if (!lineIds.length) return new Map<string, typeof claims.$inferSelect>();
  const rows = await tx.select().from(claims).where(and(inArray(claims.settlementLineId, lineIds))).orderBy(asc(claims.createdAt));
  return new Map(rows.filter((c) => c.exceptionId).map((c) => [c.settlementLineId, c]));
}

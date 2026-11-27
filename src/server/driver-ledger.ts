import { and, asc, desc, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import type { Tx } from '~/db/client';
import { adjustmentTypes, driverLoans, driverNotes, payAdjustments, payPeriods, users } from '~/db/schema';
import { can } from '~/domain/permissions';
import { periodFor } from '~/domain/periods';
import { ForbiddenError, assertCan, canRecordLoans, type Actor } from './actor';
import { audit } from './audit';
import { RuleError } from './errors';
import { payeeIdOf } from './executions';
import { assertNotLocked, getOperation } from './ops';
import { driverProfiles } from './people';
import { parseRunId } from './payroll';

// Notes and loans on a driver. Notes: the owner and dispatchers write them; everyone reads them.
// Loans and salary advances: the owner (or someone the owner allowed in Team) records them; in each payroll
// the owner decides how much to take back.
// A repayment is a deduction (a negative pay adjustment) in that payroll's period, linked to the loan.

export type LoanKind = 'loan' | 'advance';

async function deductionType(tx: Tx) {
  const [t] = await tx.select({ id: adjustmentTypes.id }).from(adjustmentTypes).where(eq(adjustmentTypes.code, 'deduction'));
  if (!t) throw new Error('Adjustment type "deduction" is missing');
  return t.id;
}

/** Loans with what was taken back and what is left, newest first. */
async function loansOf(tx: Tx, driverIds?: string[]) {
  if (driverIds && !driverIds.length) return [];
  const loans = await tx.select().from(driverLoans).where(driverIds ? inArray(driverLoans.driverId, driverIds) : undefined).orderBy(desc(driverLoans.givenOn), desc(driverLoans.createdAt));
  const repaid = loans.length ? await tx.select({ adj: payAdjustments, start: payPeriods.startDate, operationId: payPeriods.operationId })
    .from(payAdjustments).leftJoin(payPeriods, eq(payPeriods.id, payAdjustments.payPeriodId))
    .where(inArray(payAdjustments.loanId, loans.map((l) => l.id))).orderBy(asc(payAdjustments.createdAt)) : [];
  return loans.map((l) => {
    const back = repaid.filter((r) => r.adj.loanId === l.id).map((r) => ({ id: r.adj.id, amountCents: -Number(r.adj.amountCents), periodStart: r.start, operationId: r.operationId, at: r.adj.createdAt.toISOString() }));
    const amount = Number(l.amountCents);
    return { id: l.id, driverId: l.driverId, kind: l.kind as LoanKind, amountCents: amount, givenOn: l.givenOn, note: l.note, repayments: back, balanceCents: amount - back.reduce((s, b) => s + b.amountCents, 0) };
  });
}

/** One driver's notes and loans, for the driver file in Drivers and rates. */
export async function loadDriverFile(tx: Tx, actor: Actor, driverId: string, today: string) {
  assertCan(actor, 'payroll.view');
  const [person] = await driverProfiles(tx, today, [driverId]);
  if (!person) throw new RuleError('not_found');
  const notes = await tx.select({ n: driverNotes, author: users.name }).from(driverNotes).leftJoin(users, eq(users.id, driverNotes.createdBy))
    .where(eq(driverNotes.driverId, driverId)).orderBy(desc(driverNotes.createdAt));
  return {
    driver: { id: person.id, name: person.fullName },
    // Contact details; license, home address and emergency contact only for those who can edit drivers.
    details: {
      phone: person.phone, email: person.email,
      ...(can(actor.role, 'setup.edit') ? { licenseNumber: person.licenseNumber, address: person.address, emergencyName: person.emergencyName, emergencyPhone: person.emergencyPhone } : {}),
    } as { phone: string | null; email: string | null; licenseNumber?: string | null; address?: string | null; emergencyName?: string | null; emergencyPhone?: string | null },
    canWriteNotes: can(actor.role, 'drivers.confirm_today'),
    canLend: canRecordLoans(actor),
    notes: notes.map(({ n, author }) => ({ id: n.id, body: n.body, author, at: n.createdAt.toISOString(), resolved: !!n.resolvedAt }))
      .sort((a, b) => Number(a.resolved) - Number(b.resolved)),
    loans: await loansOf(tx, [driverId]),
  };
}

export async function addDriverNote(tx: Tx, actor: Actor, input: { driverId: string; body: string }) {
  assertCan(actor, 'drivers.confirm_today');
  const body = input.body.trim();
  if (!body) throw new RuleError('note_required');
  const [row] = await tx.insert(driverNotes).values({ driverId: input.driverId, body, createdBy: actor.userId }).returning();
  await audit(tx, { table: 'driver_notes', recordId: row!.id, action: 'insert', after: row, userId: actor.userId, source: actor.source });
  return row!;
}

/** Marks a note resolved, or open again. */
export async function setNoteResolved(tx: Tx, actor: Actor, id: string, resolved: boolean) {
  assertCan(actor, 'drivers.confirm_today');
  const [before] = await tx.select().from(driverNotes).where(eq(driverNotes.id, id));
  if (!before) throw new RuleError('not_found');
  const [after] = await tx.update(driverNotes).set(resolved ? { resolvedAt: new Date(), resolvedBy: actor.userId } : { resolvedAt: null, resolvedBy: null })
    .where(eq(driverNotes.id, id)).returning();
  await audit(tx, { table: 'driver_notes', recordId: id, action: 'update', before, after, userId: actor.userId, source: actor.source });
  return after!;
}

export async function addLoan(tx: Tx, actor: Actor, input: { driverId: string; kind: LoanKind; amountCents: number; givenOn: string; note: string | null }) {
  assertCan(actor, 'payroll.view');
  if (!canRecordLoans(actor)) throw new ForbiddenError('payroll.approve');
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) throw new RuleError('invalid_amount');
  const [person] = await driverProfiles(tx, input.givenOn, [input.driverId]);
  if (!person) throw new RuleError('not_found');
  const [row] = await tx.insert(driverLoans).values({
    driverId: input.driverId, kind: input.kind, amountCents: input.amountCents, givenOn: input.givenOn, note: input.note?.trim() || null, createdBy: actor.userId,
  }).returning();
  await audit(tx, { table: 'driver_loans', recordId: row!.id, action: 'insert', after: row, userId: actor.userId, source: actor.source });
  return row!;
}

async function periodOfRun(tx: Tx, runId: string) {
  const { operation, start } = parseRunId(runId);
  const op = await getOperation(tx, operation);
  const p = periodFor(op.cycleAnchor, op.payCycle, start);
  if (p.start !== start) throw new RuleError('not_found');
  await assertNotLocked(tx, op, start); // an approved payroll is locked (rule 3)
  await tx.insert(payPeriods).values({ operationId: op.id, startDate: p.start, endDate: p.end }).onConflictDoNothing();
  const [row] = await tx.select().from(payPeriods).where(and(eq(payPeriods.operationId, op.id), eq(payPeriods.startDate, p.start)));
  return row!;
}

/** The owner takes back part of a loan in one payroll: a deduction in that period, never more than is left. */
export async function deductLoan(tx: Tx, actor: Actor, input: { loanId: string; runId: string; amountCents: number }) {
  assertCan(actor, 'payroll.approve');
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) throw new RuleError('invalid_amount');
  const [loan] = await loansOf(tx).then((all) => all.filter((l) => l.id === input.loanId));
  if (!loan) throw new RuleError('not_found');
  if (input.amountCents > loan.balanceCents) throw new RuleError('more_than_owed');
  const period = await periodOfRun(tx, input.runId);
  const payeeId = (await payeeIdOf(tx, { driverId: loan.driverId, contractorId: null }))!;
  const [row] = await tx.insert(payAdjustments).values({
    payPeriodId: period.id, payeeId, typeId: await deductionType(tx), amountCents: -input.amountCents, loanId: loan.id,
    reason: loan.kind === 'loan' ? 'Loan repayment' : 'Salary advance repayment', status: 'confirmed',
    confirmedBy: actor.userId, confirmedAt: new Date(), createdBy: actor.userId,
  }).returning();
  await audit(tx, { table: 'pay_adjustments', recordId: row!.id, action: 'insert', after: row, userId: actor.userId, source: actor.source });
  return row!;
}

/** Takes a deduction back while its payroll isn't approved yet. */
export async function removeDeduction(tx: Tx, actor: Actor, input: { adjustmentId: string; runId: string }) {
  assertCan(actor, 'payroll.approve');
  const period = await periodOfRun(tx, input.runId);
  const [before] = await tx.select().from(payAdjustments).where(and(eq(payAdjustments.id, input.adjustmentId), isNotNull(payAdjustments.loanId), eq(payAdjustments.payPeriodId, period.id)));
  if (!before) throw new RuleError('not_found');
  await tx.delete(payAdjustments).where(eq(payAdjustments.id, before.id));
  await audit(tx, { table: 'pay_adjustments', recordId: before.id, action: 'delete', before, userId: actor.userId, source: actor.source });
}

/** Loans for a payroll: everyone who still owes, and what was already taken back in this run's period. */
export async function loansForRun(tx: Tx, actor: Actor, runId: string, today: string) {
  assertCan(actor, 'payroll.view');
  const { operation, start } = parseRunId(runId);
  const op = await getOperation(tx, operation);
  const [period] = await tx.select().from(payPeriods).where(and(eq(payPeriods.operationId, op.id), eq(payPeriods.startDate, start)));
  const loans = (await loansOf(tx)).filter((l) => l.balanceCents > 0 || l.repayments.some((r) => period && r.periodStart === start && r.operationId === op.id));
  const people = new Map((await driverProfiles(tx, today, [...new Set(loans.map((l) => l.driverId))])).map((p) => [p.id, p.fullName]));
  return {
    canDeduct: can(actor.role, 'payroll.approve'),
    loans: loans.map((l) => ({
      ...l, name: people.get(l.driverId) ?? '',
      thisRun: l.repayments.filter((r) => r.periodStart === start && r.operationId === op.id),
    })).sort((a, b) => a.name.localeCompare(b.name)),
  };
}

/** For the overview: open notes, newest first, and what drivers still owe. */
export async function ledgerOverview(tx: Tx, actor: Actor, today: string) {
  assertCan(actor, 'payroll.view');
  const notes = await tx.select().from(driverNotes).where(isNull(driverNotes.resolvedAt)).orderBy(desc(driverNotes.createdAt)).limit(8);
  const open = (await loansOf(tx)).filter((l) => l.balanceCents > 0);
  const names = new Map((await driverProfiles(tx, today, [...new Set([...notes.map((n) => n.driverId), ...open.map((l) => l.driverId)])])).map((p) => [p.id, p.fullName]));
  return {
    notes: notes.map((n) => ({ id: n.id, driverId: n.driverId, name: names.get(n.driverId) ?? '', body: n.body, at: n.createdAt.toISOString() })),
    owedCents: open.reduce((s, l) => s + l.balanceCents, 0),
    owing: new Set(open.map((l) => l.driverId)).size,
  };
}

/** Open notes and what is still owed, per driver, for the drivers list. */
export async function ledgerByDriver(tx: Tx) {
  const map = new Map<string, { openNotes: number; owedCents: number }>();
  const get = (id: string) => map.get(id) ?? map.set(id, { openNotes: 0, owedCents: 0 }).get(id)!;
  for (const n of await tx.select({ driverId: driverNotes.driverId }).from(driverNotes).where(isNull(driverNotes.resolvedAt))) get(n.driverId).openNotes++;
  for (const l of await loansOf(tx)) if (l.balanceCents > 0) get(l.driverId).owedCents += l.balanceCents;
  return map;
}

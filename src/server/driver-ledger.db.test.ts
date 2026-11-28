import { describe, expect, it } from 'vitest';
import { periodFor } from '~/domain/periods';
import { todayLA } from '~/domain/dates';
import { actorAs, driverNamed, withRollback } from '../../tests/helpers/db';
import { ForbiddenError } from './actor';
import { addDriverNote, addLoan, deductLoan, ledgerOverview, loadDriverFile, loansForRun, removeDeduction, setNoteResolved } from './driver-ledger';
import { getOperation } from './ops';
import { loadRun } from './payroll';
import { and, eq } from 'drizzle-orm';
import { payPeriods, payrollRuns } from '~/db/schema';

const owner = actorAs('owner');

describe('notes and loans on a driver', () => {
  it('notes: dispatchers write them, they show on the overview until resolved', () =>
    withRollback(async (tx) => {
      const d = (await driverNamed(tx, 'Norwin Saloman'))!;
      await expect(addDriverNote(tx, actorAs('viewer'), { driverId: d.id, body: 'x' })).rejects.toBeInstanceOf(ForbiddenError);
      const n = await addDriverNote(tx, actorAs('dispatcher'), { driverId: d.id, body: '  Owes the uniform ' });
      expect((await ledgerOverview(tx, owner, todayLA())).notes[0]).toMatchObject({ name: 'Norwin Saloman', body: 'Owes the uniform' });
      await setNoteResolved(tx, actorAs('dispatcher'), n.id, true);
      expect((await ledgerOverview(tx, owner, todayLA())).notes.find((x) => x.id === n.id)).toBeUndefined();
      expect((await loadDriverFile(tx, actorAs('viewer'), d.id, todayLA())).notes[0]).toMatchObject({ resolved: true });
    }));

  it('a loan is taken back in the payroll the owner picks, up to what is left, and the run pays less', () =>
    withRollback(async (tx) => {
      const d = (await driverNamed(tx, 'Karandeep Kaur'))!;
      await expect(addLoan(tx, actorAs('dispatcher'), { driverId: d.id, kind: 'loan', amountCents: 300_00, givenOn: '2026-06-10', note: null })).rejects.toBeInstanceOf(ForbiddenError);
      const loan = await addLoan(tx, owner, { driverId: d.id, kind: 'loan', amountCents: 300_00, givenOn: '2026-06-10', note: 'car repair' });
      const op = await getOperation(tx, 'tforce');
      const runId = `tforce-${periodFor(op.cycleAnchor, op.payCycle, '2026-06-18').start}`;
      const pay = async () => (await loadRun(tx, owner, runId)).lines.find((l) => l.name === 'Karandeep Kaur')!.payCents;
      const before = await pay();

      await expect(deductLoan(tx, owner, { loanId: loan.id, runId, amountCents: 400_00 })).rejects.toMatchObject({ code: 'more_than_owed' });
      const adj = await deductLoan(tx, owner, { loanId: loan.id, runId, amountCents: 100_00 });
      expect(await pay()).toBe(before - 100_00);
      const forRun = await loansForRun(tx, owner, runId, todayLA());
      expect(forRun.loans.find((l) => l.id === loan.id)).toMatchObject({ balanceCents: 200_00, thisRun: [{ amountCents: 100_00 }] });
      expect((await ledgerOverview(tx, owner, todayLA())).owedCents).toBeGreaterThanOrEqual(200_00);

      await removeDeduction(tx, owner, { adjustmentId: adj.id, runId });
      expect(await pay()).toBe(before);
    }));

  it('an approved payroll takes no new deductions', () =>
    withRollback(async (tx) => {
      const d = (await driverNamed(tx, 'Karandeep Kaur'))!;
      const loan = await addLoan(tx, owner, { driverId: d.id, kind: 'advance', amountCents: 50_00, givenOn: '2026-06-10', note: null });
      const op = await getOperation(tx, 'tforce');
      const p = periodFor(op.cycleAnchor, op.payCycle, '2026-07-01');
      await tx.insert(payPeriods).values({ operationId: op.id, startDate: p.start, endDate: p.end }).onConflictDoNothing();
      const [period] = await tx.select().from(payPeriods).where(and(eq(payPeriods.operationId, op.id), eq(payPeriods.startDate, p.start)));
      await tx.insert(payrollRuns).values({ payPeriodId: period!.id, status: 'approved', approvedAt: new Date() }).onConflictDoNothing();
      await expect(deductLoan(tx, owner, { loanId: loan.id, runId: `tforce-${p.start}`, amountCents: 10_00 })).rejects.toMatchObject({ code: 'period_locked' });
    }));

  it('the owner can let someone else record loans; deducting stays with the owner, and viewers never can', () =>
    withRollback(async (tx) => {
      const d = (await driverNamed(tx, 'Norwin Saloman'))!;
      const loan = { driverId: d.id, kind: 'advance' as const, amountCents: 5000, givenOn: '2026-06-16', note: null };
      await expect(addLoan(tx, actorAs('dispatcher'), loan)).rejects.toBeInstanceOf(ForbiddenError);
      const allowed = { ...actorAs('dispatcher'), canRecordLoans: true };
      const row = await addLoan(tx, allowed, loan);
      expect((await loadDriverFile(tx, allowed, d.id, todayLA())).canLend).toBe(true);
      await expect(addLoan(tx, { ...actorAs('viewer'), canRecordLoans: true }, loan)).rejects.toBeInstanceOf(ForbiddenError);
      const op = await getOperation(tx, 'hovership');
      const runId = `hovership-${periodFor(op.cycleAnchor, op.payCycle, '2026-06-16').start}`;
      await expect(deductLoan(tx, allowed, { loanId: row.id, runId, amountCents: 1000 })).rejects.toBeInstanceOf(ForbiddenError);
    }));
});

import { describe, expect, it } from 'vitest';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { auditLog, drivers, exceptions, operationRevenue, payPeriods, payrollLines, payrollRuns, reportImports, users, workRecords } from '~/db/schema';
import { HOVERSHIP_CSV, actorAs, clearHovership, withRollback } from '../../tests/helpers/db';
import { importHovership, resolveUnknownCode, setBonus } from './hovership';
import { approveRun, markRunPaid, reopenRun } from './payroll';

// Rule 4: every write is audited. Runs the whole Hovership flow and checks that every row it
// created or changed has an audit entry with the acting user and source.
describe('audit log (rule 4)', () => {
  it('covers import, unknown codes, bonuses, approval, reopen and paid', () =>
    withRollback(async (tx) => {
      const op = await clearHovership(tx);
      const [u] = await tx.insert(users).values({ zitadelSub: 'test:audit', name: 'Audit Owner', email: 'audit@test', role: 'owner' }).returning();
      const owner = actorAs('owner', u!.id);
      const extra = '2026-07-13,ZZZ001,New Person,0,10,0,0,0,5,Benicia,0,,\n';
      await importHovership(tx, owner, { fileName: 'f.csv', text: HOVERSHIP_CSV + extra });
      const [ex] = await tx.select().from(exceptions).where(and(eq(exceptions.operationId, op.id), eq(exceptions.status, 'open')));
      await resolveUnknownCode(tx, owner, ex!.id, { action: 'new_driver', fullName: 'New Person' });
      const [robert] = await tx.select().from(drivers).where(eq(drivers.hovershipCode, 'DUB061'));
      await setBonus(tx, owner, { driverId: robert!.id, date: '2026-06-15', bonusCents: 12_34 });
      const start = new Date('2026-06-22T17:00:00Z');
      await approveRun(tx, owner, 'hovership-2026-06-08', 13_389_00 - 40_00 + 12_34, start);
      await reopenRun(tx, owner, 'hovership-2026-06-08', start);
      await approveRun(tx, owner, 'hovership-2026-06-08', 13_389_00 - 40_00 + 12_34, start);
      await markRunPaid(tx, owner, 'hovership-2026-06-08', start);

      const audited = async (table: string, ids: string[]) => {
        if (!ids.length) return [];
        const rows = await tx.selectDistinct({ id: auditLog.recordId }).from(auditLog).where(and(eq(auditLog.tableName, table), inArray(auditLog.recordId, ids)));
        const seen = new Set(rows.map((r) => r.id));
        return ids.filter((id) => !seen.has(id));
      };
      const periodIds = (await tx.select({ id: payPeriods.id }).from(payPeriods).where(eq(payPeriods.operationId, op.id))).map((r) => r.id);
      const runIds = (await tx.select({ id: payrollRuns.id }).from(payrollRuns).where(inArray(payrollRuns.payPeriodId, periodIds))).map((r) => r.id);
      const checks: Record<string, string[]> = {
        report_imports: (await tx.select({ id: reportImports.id }).from(reportImports).where(eq(reportImports.operationId, op.id))).map((r) => r.id),
        work_records: (await tx.select({ id: workRecords.id }).from(workRecords).where(eq(workRecords.operationId, op.id))).map((r) => r.id),
        operation_revenue: (await tx.select({ id: operationRevenue.id }).from(operationRevenue).where(eq(operationRevenue.operationId, op.id))).map((r) => r.id),
        exceptions: (await tx.select({ id: exceptions.id }).from(exceptions).where(eq(exceptions.operationId, op.id))).map((r) => r.id),
        pay_periods: periodIds,
        payroll_runs: runIds,
        payroll_lines: (await tx.select({ id: payrollLines.id }).from(payrollLines).where(inArray(payrollLines.runId, runIds))).map((r) => r.id),
      };
      for (const [table, ids] of Object.entries(checks)) {
        expect(ids.length, `${table} has rows`).toBeGreaterThan(0);
        expect(await audited(table, ids), `${table} rows without audit`).toEqual([]);
      }

      const actions = await tx.select({ action: auditLog.action, n: sql<number>`count(*)::int` }).from(auditLog)
        .where(and(eq(auditLog.tableName, 'payroll_runs'), inArray(auditLog.recordId, runIds))).groupBy(auditLog.action);
      expect(Object.fromEntries(actions.map((a) => [a.action, a.n]))).toEqual({ approve: 2, reopen: 1, update: 1 });

      const bonusEdit = await tx.select().from(auditLog).where(and(eq(auditLog.tableName, 'work_records'), eq(auditLog.action, 'update'), eq(auditLog.userId, u!.id)));
      expect(bonusEdit.some((a) => (a.after as { bonusCents: number }).bonusCents === 12_34 && a.source === 'portal')).toBe(true);
    }));
});

import { describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { auditLog, contractors, drivers, operations, payPeriods, payrollRuns, routes } from '~/db/schema';
import { actorAs, withRollback } from '../../tests/helpers/db';
import { ForbiddenError } from './actor';
import { addDriverForRoute, confirmUsual, loadDay, setAssignment, undoAssignment } from './daily';

// Uses the seeded T-Force routes (pnpm db:seed). June 18 has the sample list; Sept 3 has none.
const route = async (tx: Parameters<Parameters<typeof withRollback>[0]>[0], code: string) =>
  (await tx.select().from(routes).where(eq(routes.code, code)))[0]!;

describe("today's drivers (server)", () => {
  it('June 18 shows the sample list: 9000Z has only a name nobody knows', () =>
    withRollback(async (tx) => {
      const day = await loadDay(tx, actorAs('viewer'), '2026-06-18');
      expect(day.canEdit).toBe(false);
      const z = day.rows.find((r) => r.code === '9000Z')!;
      expect(z).toMatchObject({ status: 'no_driver', rawName: 'the new guy from Puma' });
      expect(day.rows.find((r) => r.code === '9000R')!.today.name).toBe('Puma');
    }));

  it('a day without a list proposes each usual driver; "all good" confirms them', () =>
    withRollback(async (tx) => {
      const d = actorAs('dispatcher');
      const day = await loadDay(tx, d, '2026-09-03');
      expect(day.rows.length).toBe(19);
      expect(day.summary.proposed).toBeGreaterThan(0);
      const n = await confirmUsual(tx, d, '2026-09-03');
      expect(n).toBe(day.rows.filter((r) => r.status === 'proposed').length);
      expect((await loadDay(tx, d, '2026-09-03')).summary.proposed).toBe(0);
    }));

  it('a change is audited, marked changed, and Undo writes the old value back as a new entry', () =>
    withRollback(async (tx) => {
      const d = actorAs('dispatcher');
      const e = await route(tx, '9000E');
      const [norwin] = await tx.select().from(drivers).where(eq(drivers.fullName, 'Norwin Saloman'));
      const res = await setAssignment(tx, d, { date: '2026-09-03', routeId: e.id, payee: { driverId: norwin!.id } });
      let row = (await loadDay(tx, d, '2026-09-03')).rows.find((r) => r.code === '9000E')!;
      expect(row).toMatchObject({ status: 'changed', today: { name: 'Norwin Saloman' } });
      await undoAssignment(tx, d, { date: '2026-09-03', routeId: e.id, previous: res.previous });
      row = (await loadDay(tx, d, '2026-09-03')).rows.find((r) => r.code === '9000E')!;
      expect(row.status).toBe('proposed');
      const trail = await tx.select().from(auditLog).where(and(eq(auditLog.tableName, 'daily_assignments'), eq(auditLog.recordId, res.assignmentId)));
      expect(trail.map((t) => t.action).sort()).toEqual(['insert', 'undo']);
      expect((await loadDay(tx, d, '2026-09-03')).changes.filter((c) => c.route === '9000E')).toHaveLength(2);
    }));

  it('finance and viewers cannot change the list (rule 9)', () =>
    withRollback(async (tx) => {
      const a = await route(tx, '9000A');
      for (const role of ['finance', 'viewer'] as const) {
        await expect(setAssignment(tx, actorAs(role), { date: '2026-09-03', routeId: a.id, payee: null })).rejects.toBeInstanceOf(ForbiddenError);
      }
    }));

  it('adds "the new guy" under Puma and assigns him', () =>
    withRollback(async (tx) => {
      const z = await route(tx, '9000Z');
      const [puma] = await tx.select().from(contractors).where(eq(contractors.name, 'Puma'));
      const d = await addDriverForRoute(tx, actorAs('owner'), { date: '2026-06-18', routeId: z.id, fullName: 'Pedro (Puma)', contractorId: puma!.id });
      expect(d).toMatchObject({ contractorId: puma!.id, setupComplete: false });
      const row = (await loadDay(tx, actorAs('owner'), '2026-06-18')).rows.find((r) => r.code === '9000Z')!;
      expect(row).toMatchObject({ status: 'changed', today: { name: 'Pedro (Puma)' } });
    }));

  it('days in an approved T-Force period are locked', () =>
    withRollback(async (tx) => {
      const [op] = await tx.select().from(operations).where(eq(operations.code, 'tforce'));
      const [p] = await tx.insert(payPeriods).values({ operationId: op!.id, startDate: '2026-08-31', endDate: '2026-09-06' }).returning();
      await tx.insert(payrollRuns).values({ payPeriodId: p!.id, status: 'approved' });
      const a = await route(tx, '9000A');
      await expect(setAssignment(tx, actorAs('owner'), { date: '2026-09-03', routeId: a.id, payee: null })).rejects.toMatchObject({ code: 'period_locked' });
    }));
});

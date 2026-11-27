import { describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { auditLog, operations, payPeriods, payrollRuns, routeExecutions, routes, sortCodes } from '~/db/schema';
import { actorAs, withRollback, activeTforceRouteCount, driverNamed, contractorNamed } from '../../tests/helpers/db';
import { ForbiddenError } from './actor';
import { createDriver } from './people';
import { addDriverForRoute, confirmUsual, loadDay, setAssignment, setSortCodes, unconfirmUsual, undoAssignment } from './daily';

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

  it('a change after confirming updates the same route-day, and the confirmation can be taken back', () =>
    withRollback(async (tx) => {
      const d = actorAs('dispatcher');
      const date = '2026-09-03';
      const confirmed = await confirmUsual(tx, d, date);
      const e = await route(tx, '9000E');
      // Someone not on the list yet (a person on another code would be moved instead: one line per person).
      const robert = await createDriver(tx, d, { fullName: 'Test Change', hovershipCode: null, contractorId: null, phone: null, aliases: [], active: true, setupComplete: true }, date);
      await setAssignment(tx, d, { date, routeId: e.id, payee: { driverId: robert.id } });
      const rows = await tx.select().from(routeExecutions).where(and(eq(routeExecutions.routeId, e.id), eq(routeExecutions.date, date)));
      expect(rows).toHaveLength(1); // updated, never duplicated
      expect(rows[0]).toMatchObject({ status: 'changed', driverId: robert.id });

      const day = await loadDay(tx, d, date);
      expect(day.summary.usualConfirmed).toBe(confirmed - 1);
      expect(await unconfirmUsual(tx, d, date)).toBe(confirmed - 1);
      const after = await loadDay(tx, d, date);
      expect(after.summary.usualConfirmed).toBe(0);
      expect(after.summary.proposed + after.summary.contractor).toBe(confirmed - 1); // contractor routes count on their own
      expect(after.rows.find((r) => r.code === '9000E')).toMatchObject({ status: 'changed' }); // the change stays
      await expect(unconfirmUsual(tx, actorAs('viewer'), date)).rejects.toBeInstanceOf(ForbiddenError);
    }));

  it('a day without a list proposes each usual driver; "all good" confirms them', () =>
    withRollback(async (tx) => {
      const d = actorAs('dispatcher');
      const day = await loadDay(tx, d, '2026-09-03');
      expect(day.rows.length).toBe(await activeTforceRouteCount(tx));
      expect(day.summary.proposed).toBeGreaterThan(0);
      const n = await confirmUsual(tx, d, '2026-09-03');
      expect(n).toBe(day.rows.filter((r) => r.status === 'proposed').length);
      expect((await loadDay(tx, d, '2026-09-03')).summary.proposed).toBe(0);
    }));

  it('a change is audited, marked changed, and Undo writes the old value back as a new entry', () =>
    withRollback(async (tx) => {
      const d = actorAs('dispatcher');
      const e = await route(tx, '9000E');
      const norwin = await driverNamed(tx, 'Norwin Saloman');
      const res = await setAssignment(tx, d, { date: '2026-09-03', routeId: e.id, payee: { driverId: norwin!.id } });
      let row = (await loadDay(tx, d, '2026-09-03')).rows.find((r) => r.code === '9000E')!;
      expect(row).toMatchObject({ status: 'changed', today: { name: 'Norwin Saloman' } });
      await undoAssignment(tx, d, { date: '2026-09-03', routeId: e.id, previous: res.previous });
      row = (await loadDay(tx, d, '2026-09-03')).rows.find((r) => r.code === '9000E')!;
      expect(row.status).toBe('proposed');
      const trail = await tx.select().from(auditLog).where(and(eq(auditLog.tableName, 'route_executions'), eq(auditLog.recordId, res.assignmentId)));
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
      const puma = await contractorNamed(tx, 'Puma');
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

describe('routes (sort codes) a driver ran on a day', () => {
  it('adds, adds another and removes; the day keeps its usual driver and the log says which routes', () =>
    withRollback(async (tx) => {
      const owner = actorAs('owner');
      const day = await loadDay(tx, owner, '2026-12-02');
      const a = day.rows.find((r) => r.code === '9000A')!;
      const code = (c: string) => day.options.sortCodes.find((s) => s.code === c)!.id;
      expect(day.options.sortCodes.map((s) => s.code)).toEqual(expect.arrayContaining(['211', 'CVS007', 'Truck Route1']));
      await setSortCodes(tx, owner, { date: '2026-12-02', routeId: a.routeId, sortCodeIds: [code('211')] });
      await setSortCodes(tx, owner, { date: '2026-12-02', routeId: a.routeId, sortCodeIds: [code('211'), code('CVS007'), code('301')] });
      await setSortCodes(tx, owner, { date: '2026-12-02', routeId: a.routeId, sortCodeIds: [code('211'), code('CVS007')] });
      const after = await loadDay(tx, owner, '2026-12-02');
      const row = after.rows.find((r) => r.code === '9000A')!;
      expect(row.sortCodes.map((s) => s.code)).toEqual(['211', 'CVS007']);
      expect(row).toMatchObject({ status: 'proposed', today: { name: a.usual.name } });
      // One test transaction gives every entry the same time, so look for it rather than take the first.
      expect(after.changes).toContainEqual(expect.objectContaining({ route: '9000A', sortCodes: ['211', 'CVS007'] }));
      expect(after.changes.some((c) => c.sortCodes === null)).toBe(false); // creating the record isn't shown as a change of driver
      await expect(setSortCodes(tx, actorAs('finance'), { date: '2026-12-02', routeId: a.routeId, sortCodeIds: [] })).rejects.toBeInstanceOf(ForbiddenError);
      const hovership = (await tx.select().from(sortCodes).where(eq(sortCodes.code, '957')))[0]!;
      await expect(setSortCodes(tx, owner, { date: '2026-12-02', routeId: a.routeId, sortCodeIds: [hovership.id] })).rejects.toMatchObject({ code: 'not_found' });
    }));
});

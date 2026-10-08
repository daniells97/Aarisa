import { describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { auditLog, drivers, payPeriods, payrollRuns, workRecords } from '~/db/schema';
import { ALL_ROLES, HOVERSHIP_CSV, actorAs, clearHovership, withRollback } from '../../tests/helpers/db';
import { ForbiddenError } from './actor';
import { importHovership, loadHovershipWeek, resolveUnknownCode, setBonus } from './hovership';

const owner = actorAs('owner');
const header = 'pod_date,driver_code,driver_name,tier1,tier2,tier3,tier4,stat,stem,stem_reason,bonus,total_route,total_profit';

describe('Hovership import (server)', () => {
  it('imports the June sample and the week of June 15 to 21 matches spec §9', () =>
    withRollback(async (tx) => {
      await clearHovership(tx);
      const out = await importHovership(tx, owner, { fileName: 'hovership_details_jun2026.csv', text: HOVERSHIP_CSV });
      expect(out).toMatchObject({ status: 'done', rows: 319, unknownCodes: [], badLines: [], totalsMismatch: [] });
      const week = await loadHovershipWeek(tx, actorAs('finance'), '2026-06-15');
      expect(week.totals).toMatchObject({
        rows: 51, drivers: 17, t13: 2496, t4: 57, stat: 19, bonusCents: 909_75, driverPayCents: 7_344_50,
        revenueCents: 7_792_00, stemCents: 775_00, operationProfitCents: 1_222_50, marginSumCents: 447_50,
      });
      expect(week.importState?.status).toBe('done');
      expect(week.period).toEqual({ start: '2026-06-08', end: '2026-06-21' });
      expect(week.lostMoney.length).toBeGreaterThan(0);
      await expect(importHovership(tx, owner, { fileName: 'again.csv', text: HOVERSHIP_CSV })).rejects.toMatchObject({ code: 'already_imported' });
    }));

  it('hides revenue, margins and STEM from dispatchers', () =>
    withRollback(async (tx) => {
      await clearHovership(tx);
      await importHovership(tx, owner, { fileName: 'f.csv', text: HOVERSHIP_CSV });
      const week = await loadHovershipWeek(tx, actorAs('dispatcher'), '2026-06-15');
      expect(week.totals.driverPayCents).toBe(7_344_50);
      expect([week.totals.revenueCents, week.totals.stemCents, week.totals.operationProfitCents]).toEqual([null, null, null]);
      expect(week.drivers.every((d) => d.marginCents === null && d.days.every((x) => x.revenueCents === null))).toBe(true);
      expect(week.rates.every((r) => r.clientCents === null)).toBe(true);
      expect(week.lostMoney).toEqual([]);
    }));

  it('refuses a second file for days already imported', () =>
    withRollback(async (tx) => {
      await clearHovership(tx);
      await importHovership(tx, owner, { fileName: 'f.csv', text: HOVERSHIP_CSV });
      const other = `${header}\n2026-06-15,DUB061,Robert Arteaga,1,0,0,0,0,0,,0,,\n`;
      expect(await importHovership(tx, owner, { fileName: 'g.csv', text: other })).toMatchObject({ status: 'failed', reason: 'dates_already_imported', dates: ['2026-06-15'] });
    }));

  it('saves nothing when the layout changed, then continues with the confirmed column', () =>
    withRollback(async (tx) => {
      const op = await clearHovership(tx);
      const text = 'POD Date,Driver #,Tier 1,Tier 2,Tier 3,Tier 4,Stat,Stem,Bonus\n2026-09-07,DUB061,10,0,0,0,0,0,0\n';
      const first = await importHovership(tx, owner, { fileName: 'x.csv', text });
      expect(first).toMatchObject({ status: 'layout_changed', missing: ['driver_code'] });
      expect(await tx.select().from(workRecords).where(eq(workRecords.operationId, op.id))).toHaveLength(0);
      const second = await importHovership(tx, owner, { fileName: 'x.csv', text, columnOverride: { driver_code: 'Driver #' } });
      expect(second).toMatchObject({ status: 'done', rows: 1 });
    }));

  it('keeps unknown codes out until someone says who they are', () =>
    withRollback(async (tx) => {
      await clearHovership(tx);
      const text = `${header}\n2026-09-07,DUB061,Robert Arteaga,10,0,0,0,0,0,,0,25,5\n2026-09-07,NEW001,Nuevo Uno,0,30,0,2,0,0,,0,,\n2026-09-08,NEW001,Nuevo Uno,0,20,0,0,0,0,,0,,\n`;
      const out = await importHovership(tx, owner, { fileName: 'n.csv', text });
      expect(out).toMatchObject({ status: 'partial', unknownCodes: [{ code: 'NEW001', name: 'Nuevo Uno', days: 2, packages: 52 }] });
      let week = await loadHovershipWeek(tx, owner, '2026-09-07');
      expect(week.totals.rows).toBe(1);
      expect(week.unknownCodes).toHaveLength(1);
      await expect(resolveUnknownCode(tx, actorAs('viewer'), week.unknownCodes[0]!.exceptionId, { action: 'new_driver', fullName: 'Nuevo Uno' }))
        .rejects.toBeInstanceOf(ForbiddenError);
      const { driverId } = await resolveUnknownCode(tx, actorAs('dispatcher'), week.unknownCodes[0]!.exceptionId, { action: 'new_driver', fullName: 'Nuevo Uno' });
      const [d] = await tx.select().from(drivers).where(eq(drivers.id, driverId));
      expect(d).toMatchObject({ hovershipCode: 'NEW001', setupComplete: false });
      week = await loadHovershipWeek(tx, owner, '2026-09-07');
      expect(week.totals).toMatchObject({ rows: 3, t13: 60, t4: 2 });
      expect(week.unknownCodes).toEqual([]);
      expect(week.importState?.status).toBe('done');
    }));

  it('bonus edits are audited, role-checked and blocked once payroll is approved', () =>
    withRollback(async (tx) => {
      const op = await clearHovership(tx);
      await importHovership(tx, owner, { fileName: 'f.csv', text: HOVERSHIP_CSV });
      const [robert] = await tx.select().from(drivers).where(eq(drivers.hovershipCode, 'DUB061'));
      const input = { driverId: robert!.id, date: '2026-06-15', bonusCents: 25_00 };
      for (const role of ALL_ROLES.filter((r) => r === 'dispatcher' || r === 'viewer')) {
        await expect(setBonus(tx, actorAs(role), input)).rejects.toBeInstanceOf(ForbiddenError);
      }
      const rec = await setBonus(tx, actorAs('finance'), input);
      const trail = await tx.select().from(auditLog).where(and(eq(auditLog.recordId, rec.id), eq(auditLog.action, 'update')));
      expect(trail).toHaveLength(1);
      const [period] = await tx.insert(payPeriods).values({ operationId: op.id, startDate: '2026-06-08', endDate: '2026-06-21' }).returning();
      await tx.insert(payrollRuns).values({ payPeriodId: period!.id, status: 'approved' });
      await expect(setBonus(tx, owner, { ...input, bonusCents: 0 })).rejects.toMatchObject({ code: 'period_locked' });
      expect((await loadHovershipWeek(tx, owner, '2026-06-15')).canEditBonus).toBe(false);
    }));

  it('dispatchers and viewers cannot import', () =>
    withRollback(async (tx) => {
      for (const role of ['dispatcher', 'viewer'] as const) {
        await expect(importHovership(tx, actorAs(role), { fileName: 'f.csv', text: HOVERSHIP_CSV })).rejects.toBeInstanceOf(ForbiddenError);
      }
    }));
});

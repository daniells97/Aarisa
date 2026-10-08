import { describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { auditLog, drivers, users, workRecords } from '~/db/schema';
import { HOVERSHIP_CSV, actorAs, clearHovership, withRollback } from '../../tests/helpers/db';
import { ForbiddenError } from './actor';
import { importHovership, setBonus } from './hovership';
import { approveRun, exportRun, listRuns, loadRun, markRunPaid, reopenRun } from './payroll';

const RUN = 'hovership-2026-06-08';

async function setup(tx: Parameters<Parameters<typeof withRollback>[0]>[0]) {
  await clearHovership(tx);
  const [u] = await tx.insert(users).values({ zitadelSub: 'test:payroll-owner', name: 'Owner T', email: 'po@test', role: 'owner' }).returning();
  const owner = actorAs('owner', u!.id);
  await importHovership(tx, owner, { fileName: 'f.csv', text: HOVERSHIP_CSV });
  return owner;
}

describe('payroll runs (server)', () => {
  it('the June 8 to 21 run is ready with spec §9 totals', () =>
    withRollback(async (tx) => {
      const owner = await setup(tx);
      const run = await loadRun(tx, owner, RUN);
      expect(run.status).toBe('ready');
      expect(run.period).toEqual({ start: '2026-06-08', end: '2026-06-21' });
      expect(run.totals).toMatchObject({ drivers: 20, routeDays: 90, packages: 4_626, stops: 43, bonusCents: 1_684_75, payCents: 13_389_00, otherRevenueCents: 1_495_00, profitCents: 2_313_00 });
      const list = await listRuns(tx, owner);
      expect(list.runs.map((r) => r.period.start)).toEqual(['2026-07-06', '2026-06-22', '2026-06-08', '2026-05-25']);
    }));

  it('only the owner approves, with the exact amount shown, and approval locks the run', () =>
    withRollback(async (tx) => {
      const owner = await setup(tx);
      for (const role of ['dispatcher', 'finance', 'viewer'] as const) {
        await expect(approveRun(tx, actorAs(role), RUN, 13_389_00)).rejects.toBeInstanceOf(ForbiddenError);
      }
      await expect(approveRun(tx, owner, RUN, 13_000_00)).rejects.toMatchObject({ code: 'total_changed' });
      const now = new Date('2026-06-22T17:00:00Z');
      await approveRun(tx, owner, RUN, 13_389_00, now);

      const run = await loadRun(tx, owner, RUN, now);
      expect(run).toMatchObject({ status: 'approved', canReopen: true, canMarkPaid: true });
      expect(run.lines).toHaveLength(20);
      // rates are snapshotted on every work record
      const recs = await tx.select().from(workRecords).where(and(eq(workRecords.date, '2026-06-15'), eq(workRecords.tier, 't4')));
      expect(recs.every((r) => r.driverRateCents === 175 && r.clientRateCents === 200 && r.payrollRunId)).toBe(true);
      // locked: bonuses can't change, and a second approval is refused
      const [robert] = await tx.select().from(drivers).where(eq(drivers.hovershipCode, 'DUB061'));
      await expect(setBonus(tx, owner, { driverId: robert!.id, date: '2026-06-15', bonusCents: 1 })).rejects.toMatchObject({ code: 'period_locked' });
      await expect(approveRun(tx, owner, RUN, 13_389_00, now)).rejects.toMatchObject({ code: 'already_approved' });
      const trail = await tx.select().from(auditLog).where(and(eq(auditLog.tableName, 'payroll_runs'), eq(auditLog.action, 'approve')));
      expect(trail.some((a) => a.userId === owner.userId)).toBe(true);
    }));

  it('reopen is owner only, within 24 hours, audited, and re-approval uses the new numbers', () =>
    withRollback(async (tx) => {
      const owner = await setup(tx);
      const approvedAt = new Date('2026-06-22T17:00:00Z');
      await approveRun(tx, owner, RUN, 13_389_00, approvedAt);
      await expect(reopenRun(tx, actorAs('finance'), RUN, approvedAt)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(reopenRun(tx, owner, RUN, new Date('2026-06-23T17:00:01Z'))).rejects.toMatchObject({ code: 'reopen_expired' });
      await reopenRun(tx, owner, RUN, new Date('2026-06-23T16:59:00Z'));
      const [robert] = await tx.select().from(drivers).where(eq(drivers.hovershipCode, 'DUB061'));
      const [rec] = await tx.select().from(workRecords).where(and(eq(workRecords.driverId, robert!.id), eq(workRecords.date, '2026-06-15'), eq(workRecords.tier, 't1_3')));
      await setBonus(tx, owner, { driverId: robert!.id, date: '2026-06-15', bonusCents: rec!.bonusCents + 10_00 });
      const reopened = await loadRun(tx, owner, RUN);
      expect(reopened.status).toBe('reopened');
      expect(reopened.totals.payCents).toBe(13_399_00);
      await approveRun(tx, owner, RUN, 13_399_00);
      expect((await loadRun(tx, owner, RUN)).status).toBe('approved');
      const reopens = await tx.select().from(auditLog).where(eq(auditLog.action, 'reopen'));
      expect(reopens.length).toBeGreaterThan(0);
    }));

  it('hides profit from dispatchers and lets finance export the payroll file', () =>
    withRollback(async (tx) => {
      const owner = await setup(tx);
      const d = await loadRun(tx, actorAs('dispatcher'), RUN);
      expect(d.totals.payCents).toBe(13_389_00);
      expect([d.totals.profitCents, d.totals.revenueCents]).toEqual([null, null]);
      expect(d.lines.every((l) => l.marginCents === null)).toBe(true);
      await expect(exportRun(tx, actorAs('dispatcher'), RUN)).rejects.toBeInstanceOf(ForbiddenError);
      const draft = await exportRun(tx, actorAs('finance'), RUN);
      expect(draft.fileName).toBe('aarisa-hovership-payroll-2026-06-08-draft.csv');
      await approveRun(tx, owner, RUN, 13_389_00);
      const file = await exportRun(tx, actorAs('finance'), RUN);
      expect(file.fileName).toBe('aarisa-hovership-payroll-2026-06-08.csv');
      const rows = file.csv.trim().split('\r\n');
      expect(rows).toHaveLength(22); // header + 20 drivers + total
      expect(rows.at(-1)!.endsWith(',1684.75,13389.00')).toBe(true);
      await markRunPaid(tx, owner, RUN);
      expect((await loadRun(tx, owner, RUN)).status).toBe('paid');
    }));

  it('a period with a missing weekly report is not ready', () =>
    withRollback(async (tx) => {
      const owner = await setup(tx);
      const run = await loadRun(tx, owner, 'hovership-2026-07-06'); // July 6 to 19, only July 6 to 10 in the file
      expect(run.status).toBe('draft');
      expect(run.blockers).toEqual([{ kind: 'missing_report', weeks: ['2026-07-13'] }]);
      await expect(approveRun(tx, owner, 'hovership-2026-07-06', run.totals.payCents)).rejects.toMatchObject({ code: 'run_not_ready' });
    }));
});

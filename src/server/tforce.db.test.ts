import { describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { contractors, drivers, routes, settlementLines, workRecords } from '~/db/schema';
import { TFORCE_CSV, actorAs, clearTforceReports, withRollback } from '../../tests/helpers/db';
import { ForbiddenError } from './actor';
import { addDriverForRoute, setAssignment } from './daily';
import { importTforce, loadTforceWeek, recheckForDate, resolveTforceException } from './tforce';

// Uses the seeded routes and sample daily list for June 15 to 20 (pnpm db:seed).
const WEEK = '2026-06-15';
const owner = actorAs('owner');

async function imported(tx: Parameters<Parameters<typeof withRollback>[0]>[0]) {
  await clearTforceReports(tx);
  const out = await importTforce(tx, owner, { fileName: 'tforce_pieces_jun2026.csv', text: TFORCE_CSV });
  return { out, week: await loadTforceWeek(tx, owner, WEEK) };
}

describe('T-Force weekly check (server)', () => {
  it('the June 15 to 20 report matches spec §9 and shows the three sample exceptions', () =>
    withRollback(async (tx) => {
      const { out, week } = await imported(tx);
      expect(out).toMatchObject({ status: 'done', rows: 74, pieces: 4910, weeks: [WEEK], newRoutes: [], openExceptions: 3 });
      expect(week.summary).toMatchObject({ pieces: 4910, routes: 19, routeDays: 74, matched: 71, contractorRouteDays: 10, contractorRoutes: ['9000R', '9000S'], open: 3 });
      expect(week.dailyTotals).toEqual([1112, 870, 774, 796, 740, 618]);
      expect(week.exceptions.filter((e) => e.status === 'open').map((e) => [e.type, e.route, e.date, e.pieces])).toEqual([
        ['unknown_name', '9000Z', '2026-06-18', 34],
        ['low_pieces', '9000W', '2026-06-18', 1],
        ['low_pieces', '9000Z', '2026-06-19', 1],
      ].sort((a, b) => String(a[2]).localeCompare(String(b[2])) || String(a[1]).localeCompare(String(b[1]))));
      const w = week.exceptions.find((e) => e.route === '9000W')!;
      expect(w).toMatchObject({ payee: 'Karandeep Kaur', low: 69, high: 95 });
      const zFri = week.exceptions.find((e) => e.route === '9000Z' && e.date === '2026-06-19')!;
      expect([zFri.dayBefore, zFri.dayAfter]).toEqual([34, 94]);
    }));

  it('clearing all three lets the week through; Ask T-Force creates a claim line', () =>
    withRollback(async (tx) => {
      const { week } = await imported(tx);
      const [puma] = await tx.select().from(contractors).where(eq(contractors.name, 'Puma'));
      const open = week.exceptions.filter((e) => e.status === 'open');
      const unknown = open.find((e) => e.type === 'unknown_name')!;
      const [z] = await tx.select().from(routes).where(eq(routes.code, '9000Z'));
      const newGuy = await addDriverForRoute(tx, owner, { date: '2026-06-18', routeId: z!.id, fullName: 'New Puma driver', contractorId: puma!.id });
      await recheckForDate(tx, owner, '2026-06-18'); // fixing the daily list closes the exception
      let after = await loadTforceWeek(tx, owner, WEEK);
      expect(after.exceptions.find((e) => e.id === unknown.id)!.status).toBe('resolved');
      const [rec] = await tx.select().from(workRecords).where(and(eq(workRecords.routeId, z!.id), eq(workRecords.date, '2026-06-18')));
      expect(rec!.driverId).toBe(newGuy.id);

      const finance = actorAs('finance');
      await resolveTforceException(tx, finance, open.find((e) => e.route === '9000W')!.id, { action: 'pay_as_reported' });
      await resolveTforceException(tx, actorAs('dispatcher'), open.find((e) => e.route === '9000Z' && e.date === '2026-06-19')!.id, { action: 'ask_client', note: 'one piece' });
      after = await loadTforceWeek(tx, owner, WEEK);
      expect(after.summary.open).toBe(0);
      const claims = await tx.select().from(settlementLines).where(eq(settlementLines.kind, 'claim_adjustment'));
      expect(claims.some((c) => c.reference?.startsWith('9000Z 2026-06-19') && c.status === 'claim_ready')).toBe(true);
    }));

  it('assigning a driver from the exception updates the daily list (finance may do it)', () =>
    withRollback(async (tx) => {
      const { week } = await imported(tx);
      const unknown = week.exceptions.find((e) => e.type === 'unknown_name')!;
      const [marcus] = await tx.select().from(drivers).where(eq(drivers.fullName, 'Marcus Dub'));
      const done = await resolveTforceException(tx, actorAs('finance'), unknown.id, { action: 'assign', payee: { driverId: marcus!.id } });
      expect(done.status).toBe('resolved');
      await expect(resolveTforceException(tx, owner, unknown.id, { action: 'not_ours' })).rejects.toMatchObject({ code: 'already_resolved' });
    }));

  it('roles: viewers cannot resolve, dispatchers cannot import, wrong resolution is refused', () =>
    withRollback(async (tx) => {
      const { week } = await imported(tx);
      const low = week.exceptions.find((e) => e.type === 'low_pieces')!;
      await expect(resolveTforceException(tx, actorAs('viewer'), low.id, { action: 'pay_as_reported' })).rejects.toBeInstanceOf(ForbiddenError);
      await expect(resolveTforceException(tx, owner, low.id, { action: 'not_ours' })).rejects.toMatchObject({ code: 'resolution_not_allowed' });
      await expect(importTforce(tx, actorAs('dispatcher'), { fileName: 'x.csv', text: TFORCE_CSV })).rejects.toBeInstanceOf(ForbiddenError);
      expect(await importTforce(tx, owner, { fileName: 'again.csv', text: TFORCE_CSV + '\n' })).toMatchObject({ status: 'failed', reason: 'dates_already_imported' });
    }));

  it('a list entry without a report row is a no_pieces exception', () =>
    withRollback(async (tx) => {
      await imported(tx);
      const [v] = await tx.select().from(routes).where(eq(routes.code, '9000V'));
      const [w] = await tx.select().from(drivers).where(eq(drivers.fullName, 'William Joseph'));
      await setAssignment(tx, owner, { date: '2026-06-20', routeId: v!.id, payee: { driverId: w!.id } });
      await recheckForDate(tx, owner, '2026-06-20');
      const week = await loadTforceWeek(tx, owner, WEEK);
      expect(week.exceptions.filter((e) => e.status === 'open' && e.type === 'no_pieces').map((e) => [e.route, e.date, e.payee])).toEqual([['9000V', '2026-06-20', 'William Joseph']]);
    }));
});

import { describe, expect, it } from 'vitest';
import { actorAs, withRollback } from '../../tests/helpers/db';
import { ForbiddenError } from './actor';
import { addHovershipPerson, setOnHovership, confirmUsualHovership, loadHovershipDay, setHovershipRoutes, setHovershipUsual, unconfirmUsualHovership } from './hovership-day';
import { periodFor } from '~/domain/periods';
import { getOperation } from './ops';
import { loadRun } from './payroll';

const DATE = '2026-12-07';
const owner = actorAs('owner');

describe("Today's drivers for Hovership", () => {
  it('lists people on Hovership, gives them routes, and shows routes nobody has or two people share', () =>
    withRollback(async (tx) => {
      const op = await getOperation(tx, 'hovership');
      const runId = `hovership-${periodFor(op.cycleAnchor, op.payCycle, DATE).start}`;
      const payBefore = (await loadRun(tx, owner, runId)).lines.reduce((x, l) => x + l.payCents + l.routeDays, 0);
      const day = await loadHovershipDay(tx, actorAs('viewer'), DATE);
      expect(day.rows.length).toBeGreaterThan(0);
      expect(day.summary.unassigned).toHaveLength(day.options.sortCodes.length);
      const [a, b] = day.rows;
      const id = (c: string) => day.options.sortCodes.find((s) => s.code === c)!.id;
      await setHovershipRoutes(tx, owner, { date: DATE, driverId: a!.driverId, sortCodeIds: [id('200'), id('202')] });
      await setHovershipRoutes(tx, owner, { date: DATE, driverId: b!.driverId, sortCodeIds: [id('202')] });
      await expect(setHovershipRoutes(tx, actorAs('finance'), { date: DATE, driverId: a!.driverId, sortCodeIds: [] })).rejects.toBeInstanceOf(ForbiddenError);
      const after = await loadHovershipDay(tx, owner, DATE);
      expect(after.rows.find((r) => r.driverId === a!.driverId)!.sortCodes.map((s) => s.code)).toEqual(['200', '202']);
      expect(after.summary.working).toBe(2);
      expect(after.summary.unassigned).not.toContain('200');
      expect(after.summary.shared).toEqual([{ code: '202', who: [a!.name, b!.name] }]);
      expect(after.changes).toHaveLength(2);
      // A day with routes but no report yet pays nothing and adds no driver-day.
      expect((await loadRun(tx, owner, runId)).lines.reduce((x, l) => x + l.payCents + l.routeDays, 0)).toBe(payBefore);
    }));

  it('works like T-Force: usual routes suggested, confirmed in one tap, a change, a day off, and undo', () =>
    withRollback(async (tx) => {
      const day = await loadHovershipDay(tx, owner, DATE);
      const [a, b, c] = day.rows;
      const id = (x: string) => day.options.sortCodes.find((s) => s.code === x)!.id;
      for (const r of [a!, b!, c!]) await setHovershipUsual(tx, owner, { driverId: r.driverId, sortCodeIds: [] });
      await setHovershipUsual(tx, owner, { driverId: a!.driverId, sortCodeIds: [id('200')] });
      await setHovershipUsual(tx, owner, { driverId: b!.driverId, sortCodeIds: [id('202'), id('203')] });
      await expect(setHovershipUsual(tx, actorAs('dispatcher'), { driverId: a!.driverId, sortCodeIds: [] })).rejects.toBeInstanceOf(ForbiddenError);
      const row = async (driverId: string) => (await loadHovershipDay(tx, owner, DATE)).rows.find((r) => r.driverId === driverId)!;
      expect(await row(a!.driverId)).toMatchObject({ status: 'proposed', suggested: true, sortCodes: [{ code: '200' }] });
      expect(await row(c!.driverId)).toMatchObject({ status: 'none', sortCodes: [] });

      // Someone with no usual routes keeps the first ones picked; another route than the usual is a change.
      await setHovershipRoutes(tx, owner, { date: DATE, driverId: c!.driverId, sortCodeIds: [id('205')] });
      expect(await row(c!.driverId)).toMatchObject({ status: 'confirmed', usual: [{ code: '205' }] });
      await setHovershipRoutes(tx, owner, { date: DATE, driverId: b!.driverId, sortCodeIds: [id('202')] });
      expect(await row(b!.driverId)).toMatchObject({ status: 'changed', suggested: false, sortCodes: [{ code: '202' }] });

      const proposed = (await loadHovershipDay(tx, owner, DATE)).summary.proposed;
      expect(await confirmUsualHovership(tx, actorAs('dispatcher'), DATE)).toBe(proposed);
      const after = await loadHovershipDay(tx, owner, DATE);
      expect(after.summary.proposed).toBe(0);
      expect(after.rows.find((r) => r.driverId === a!.driverId)).toMatchObject({ status: 'confirmed', sortCodes: [{ code: '200' }], setBy: { source: 'portal' } });

      // Undo: confirmed on the usual routes goes back to suggested; the change and the off day stay.
      await setHovershipRoutes(tx, owner, { date: DATE, driverId: c!.driverId, sortCodeIds: [] });
      expect(await row(c!.driverId)).toMatchObject({ status: 'off' });
      const back = await unconfirmUsualHovership(tx, owner, DATE);
      expect(back).toBe(after.summary.usualConfirmed - 1); // c was confirmed on its usual, then set off
      expect(await row(a!.driverId)).toMatchObject({ status: 'proposed', suggested: true });
      expect(await row(b!.driverId)).toMatchObject({ status: 'changed' });
      expect(await row(c!.driverId)).toMatchObject({ status: 'off' });
    }));

  it('people are added (existing, or new from the same picker) and taken off the list', () =>
    withRollback(async (tx) => {
      const d = actorAs('dispatcher');
      const first = (await loadHovershipDay(tx, d, DATE)).rows[0]!;
      await setOnHovership(tx, d, first.driverId, false);
      const day = await loadHovershipDay(tx, d, DATE);
      const other = day.options.others.find((o) => o.id === first.driverId)!;
      expect(day.rows.some((r) => r.driverId === first.driverId)).toBe(false);
      await addHovershipPerson(tx, d, { driverId: other.id });
      expect((await loadHovershipDay(tx, d, DATE)).rows.some((r) => r.driverId === other.id)).toBe(true);
      const made = await addHovershipPerson(tx, d, { newName: 'Zoe Testperson' });
      expect(made.created).toBe(true);
      const row = (await loadHovershipDay(tx, d, DATE)).rows.find((r) => r.driverId === made.driverId);
      expect(row).toMatchObject({ name: 'Zoe Testperson', status: 'none' });
      await expect(addHovershipPerson(tx, d, { newName: 'Zoe Testperson' })).rejects.toMatchObject({ code: 'driver_exists' });
      await setOnHovership(tx, d, made.driverId, false);
      expect((await loadHovershipDay(tx, d, DATE)).rows.some((r) => r.driverId === made.driverId)).toBe(false);
      await expect(setOnHovership(tx, actorAs('viewer'), made.driverId, true)).rejects.toBeInstanceOf(ForbiddenError);
    }));
});

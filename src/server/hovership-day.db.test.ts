import { describe, expect, it } from 'vitest';
import { actorAs, withRollback } from '../../tests/helpers/db';
import { ForbiddenError } from './actor';
import { coverHovership, copyPreviousHovership, removeHovershipLine, restoreHovership, addHovershipPerson, setOnHovership, confirmUsualHovership, loadHovershipDay, setHovershipRoutes, setHovershipUsual, unconfirmUsualHovership } from './hovership-day';
import { drivers } from '~/db/schema';
import { eq } from 'drizzle-orm';
import { periodFor } from '~/domain/periods';
import { getOperation } from './ops';
import { loadRun } from './payroll';

const DATE = '2026-12-07';
const owner = actorAs('owner');

type Tx = Parameters<Parameters<typeof withRollback>[0]>[0];
const PREV = '2026-12-06';
// The first `n` people on Hovership (not on the day yet), and the sort code id by name.
async function people(tx: Tx, n: number, date = DATE) {
  const day = await loadHovershipDay(tx, owner, date);
  const all = day.options.drivers.filter((x) => !x.contractor).slice(0, n);
  return { ids: all.map((x) => x.id), names: all.map((x) => x.name), id: (c: string) => day.options.sortCodes.find((s) => s.code === c)!.id };
}

describe("Today's drivers for Hovership", () => {
  it('a day nobody filled starts empty; people added get routes; routes nobody has or two people share', () =>
    withRollback(async (tx) => {
      const op = await getOperation(tx, 'hovership');
      const runId = `hovership-${periodFor(op.cycleAnchor, op.payCycle, DATE).start}`;
      const payBefore = (await loadRun(tx, owner, runId)).lines.reduce((x, l) => x + l.payCents + l.routeDays, 0);
      const day = await loadHovershipDay(tx, actorAs('viewer'), DATE);
      expect(day.rows).toHaveLength(0);
      expect(day.summary.unassigned).toHaveLength(day.options.sortCodes.length);
      const { ids: [a, b], id } = await people(tx, 2);
      await setHovershipRoutes(tx, owner, { date: DATE, driverId: a!, sortCodeIds: [id('200'), id('202')] });
      // A route is run by one person a day: 202 is a's, so b can't have it too (client request, Nov 27 2026).
      await expect(setHovershipRoutes(tx, owner, { date: DATE, driverId: b!, sortCodeIds: [id('202')] })).rejects.toMatchObject({ code: 'route_taken' });
      await setHovershipRoutes(tx, owner, { date: DATE, driverId: b!, sortCodeIds: [id('203')] });
      await expect(setHovershipRoutes(tx, actorAs('finance'), { date: DATE, driverId: a!, sortCodeIds: [] })).rejects.toBeInstanceOf(ForbiddenError);
      const after = await loadHovershipDay(tx, owner, DATE);
      expect(after.rows).toHaveLength(2);
      expect(after.rows.find((r) => r.driverId === a)!.sortCodes.map((s) => s.code)).toEqual(['200', '202']);
      expect(after.summary.working).toBe(2);
      expect(after.summary.unassigned).not.toContain('200');
      expect(after.summary.shared).toEqual([]);
      // A day with routes but no report yet pays nothing and adds no driver-day.
      expect((await loadRun(tx, owner, runId)).lines.reduce((x, l) => x + l.payCents + l.routeDays, 0)).toBe(payBefore);
    }));

  it('"Copy the previous day" brings its list with the same routes, to confirm; confirm, change, undo, didn\'t work', () =>
    withRollback(async (tx) => {
      const { ids: [a, b, c], id } = await people(tx, 3, PREV);
      for (const x of [a!, b!, c!]) await setHovershipUsual(tx, owner, { driverId: x, sortCodeIds: [] });
      await setHovershipUsual(tx, owner, { driverId: a!, sortCodeIds: [id('200')] });
      await setHovershipUsual(tx, owner, { driverId: b!, sortCodeIds: [id('202'), id('203')] });
      await setHovershipRoutes(tx, owner, { date: PREV, driverId: a!, sortCodeIds: [id('200')] });
      await setHovershipRoutes(tx, owner, { date: PREV, driverId: b!, sortCodeIds: [id('202'), id('203')] });
      await setHovershipRoutes(tx, owner, { date: PREV, driverId: c!, sortCodeIds: [id('205')] });
      const row = async (driverId: string) => (await loadHovershipDay(tx, owner, DATE)).rows.find((r) => r.driverId === driverId)!;
      expect((await loadHovershipDay(tx, owner, DATE)).previous).toMatchObject({ date: PREV, missing: 3 });
      expect(await copyPreviousHovership(tx, actorAs('dispatcher'), DATE)).toBe(3);
      expect(await copyPreviousHovership(tx, actorAs('dispatcher'), DATE)).toBe(0); // nobody twice
      expect(await row(a!)).toMatchObject({ status: 'proposed', suggested: true, sortCodes: [{ code: '200' }] });
      expect(await row(c!)).toMatchObject({ status: 'proposed', sortCodes: [{ code: '205' }] });

      // Another route than the usual is a change.
      await setHovershipRoutes(tx, owner, { date: DATE, driverId: b!, sortCodeIds: [id('202')] });
      expect(await row(b!)).toMatchObject({ status: 'changed', suggested: false, sortCodes: [{ code: '202' }] });
      expect(await confirmUsualHovership(tx, actorAs('dispatcher'), DATE)).toBe(2);
      const after = await loadHovershipDay(tx, owner, DATE);
      expect(after.summary.proposed).toBe(0);
      expect(after.rows.find((r) => r.driverId === a)).toMatchObject({ status: 'confirmed', sortCodes: [{ code: '200' }], setBy: { source: 'portal' } });

      // Back to "to confirm" for the ones confirmed on their usual routes; the change stays.
      const back = await unconfirmUsualHovership(tx, owner, DATE);
      expect(back).toBe(after.summary.usualConfirmed);
      expect(await row(a!)).toMatchObject({ status: 'proposed', suggested: true, sortCodes: [{ code: '200' }] });
      expect(await row(b!)).toMatchObject({ status: 'changed' });
    }));

  it('people are added (existing, or new from the same picker); the × takes them off that day only, with Undo', () =>
    withRollback(async (tx) => {
      const d = actorAs('dispatcher');
      const { ids: [a] } = await people(tx, 1);
      await addHovershipPerson(tx, d, { driverId: a!, date: DATE });
      expect((await loadHovershipDay(tx, d, DATE)).rows.find((r) => r.driverId === a)).toMatchObject({ status: 'confirmed', sortCodes: [] });
      const made = await addHovershipPerson(tx, d, { newName: 'Zoe Testperson', date: DATE });
      expect(made.created).toBe(true);
      expect((await loadHovershipDay(tx, d, DATE)).rows.find((r) => r.driverId === made.driverId)).toMatchObject({ name: 'Zoe Testperson' });
      await expect(addHovershipPerson(tx, d, { newName: 'Zoe Testperson' })).rejects.toMatchObject({ code: 'driver_exists' });
      const was = await removeHovershipLine(tx, d, { date: DATE, driverId: a! });
      expect((await loadHovershipDay(tx, d, DATE)).rows.some((r) => r.driverId === a)).toBe(false);
      expect((await tx.select().from(drivers).where(eq(drivers.id, a!)))[0]!.worksHovership).toBe(true); // still on Hovership
      await restoreHovership(tx, d, { date: DATE, previous: [was!] });
      expect((await loadHovershipDay(tx, d, DATE)).rows.some((r) => r.driverId === a)).toBe(true);
      await expect(setOnHovership(tx, actorAs('viewer'), made.driverId, true)).rejects.toBeInstanceOf(ForbiddenError);
    }));

  it('"Driver today": someone else runs a person\'s routes, Undo or picking them again puts it back', () =>
    withRollback(async (tx) => {
      const d = actorAs('dispatcher');
      const { ids: [a, b], names: [, bName], id } = await people(tx, 2);
      for (const x of [a!, b!]) await setHovershipUsual(tx, owner, { driverId: x, sortCodeIds: [] });
      await setHovershipUsual(tx, owner, { driverId: a!, sortCodeIds: [id('200'), id('202')] });
      await setHovershipUsual(tx, owner, { driverId: b!, sortCodeIds: [id('210')] });
      await setHovershipRoutes(tx, owner, { date: DATE, driverId: a!, sortCodeIds: [id('200'), id('202')] });
      await setHovershipRoutes(tx, owner, { date: DATE, driverId: b!, sortCodeIds: [id('210')] });
      const row = async (x: string) => (await loadHovershipDay(tx, owner, DATE)).rows.find((r) => r.driverId === x)!;

      const res = await coverHovership(tx, d, { date: DATE, driverId: a!, by: { driverId: b! } });
      expect(res.name).toBe(bName);
      expect(await row(a!)).toMatchObject({ status: 'covered', today: { driverId: b }, sortCodes: [] });
      expect((await row(b!)).sortCodes.map((s) => s.code)).toEqual(['200', '202', '210']);

      await restoreHovership(tx, d, { date: DATE, previous: res.previous });
      expect(await row(a!)).toMatchObject({ status: 'confirmed', today: { driverId: a }, sortCodes: [{ code: '200' }, { code: '202' }] });
      expect((await row(b!)).sortCodes.map((s) => s.code)).toEqual(['210']);

      await coverHovership(tx, d, { date: DATE, driverId: a!, by: { driverId: b! } });
      await coverHovership(tx, d, { date: DATE, driverId: a!, by: { driverId: a! } });
      expect(await row(a!)).toMatchObject({ status: 'confirmed', sortCodes: [{ code: '200' }, { code: '202' }] });
      expect((await row(b!)).sortCodes.map((s) => s.code)).toEqual(['210']);

      const fresh = await coverHovership(tx, d, { date: DATE, driverId: b!, by: { newName: 'Nuevo Cubre Ruta' } });
      expect(fresh.name).toBe('Nuevo Cubre Ruta');
      expect(await row(b!)).toMatchObject({ status: 'covered', today: { name: 'Nuevo Cubre Ruta' } });
      await expect(coverHovership(tx, actorAs('finance'), { date: DATE, driverId: a!, by: { driverId: b! } })).rejects.toBeInstanceOf(ForbiddenError);
    }));
});

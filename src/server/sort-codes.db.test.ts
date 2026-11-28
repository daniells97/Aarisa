import { describe, expect, it } from 'vitest';
import { actorAs, withRollback } from '../../tests/helpers/db';
import { ForbiddenError } from './actor';
import { confirmUsual, loadDay, setSortCodes } from './daily';
import { addSortCode, loadSortCodes, setUsualSortCodes, updateSortCode } from './sort-codes';

const owner = actorAs('owner');
const DATE = '2026-12-03';

describe('routes (sort codes) kept by the owner', () => {
  it('adds, refuses a duplicate, renames and turns a route off; only the owner edits', () =>
    withRollback(async (tx) => {
      const row = await addSortCode(tx, owner, { operation: 'tforce', code: '  Truck   Route3 ' });
      expect(row.code).toBe('Truck Route3');
      await expect(addSortCode(tx, owner, { operation: 'tforce', code: 'truck route3' })).rejects.toMatchObject({ code: 'sort_code_exists' });
      await expect(addSortCode(tx, actorAs('dispatcher'), { operation: 'tforce', code: '999' })).rejects.toBeInstanceOf(ForbiddenError);
      await updateSortCode(tx, owner, row.id, { code: 'Truck Route 3', active: false });
      const tf = (await loadSortCodes(tx, actorAs('viewer'))).operations.find((o) => o.code === 'tforce')!;
      expect(tf.sortCodes.find((c) => c.id === row.id)).toMatchObject({ code: 'Truck Route 3', active: false });
      expect((await loadDay(tx, owner, DATE)).options.sortCodes.map((c) => c.code)).not.toContain('Truck Route 3');
    }));

  it("usual routes are suggested, saved when the day is confirmed, and gone once someone takes them off", () =>
    withRollback(async (tx) => {
      const setup = (await loadSortCodes(tx, owner)).operations.find((o) => o.code === 'tforce')!;
      const id = (c: string) => setup.sortCodes.find((s) => s.code === c)!.id;
      const a = setup.drivers.find((d) => d.code === '9000A')!;
      const b = setup.drivers.find((d) => d.code === '9000B')!;
      await setUsualSortCodes(tx, owner, { routeId: a.routeId, sortCodeIds: [id('211'), id('CVS007')] });
      await setUsualSortCodes(tx, owner, { routeId: b.routeId, sortCodeIds: [id('301')] });

      const day = await loadDay(tx, owner, DATE);
      expect(day.rows.find((r) => r.code === '9000A')).toMatchObject({ sortCodesSuggested: true, sortCodes: [{ code: '211' }, { code: 'CVS007' }] });

      // 9000B: someone takes the suggestion off before confirming; confirming doesn't bring it back.
      await setSortCodes(tx, owner, { date: DATE, routeId: b.routeId, sortCodeIds: [] });
      await confirmUsual(tx, owner, DATE);
      const after = await loadDay(tx, owner, DATE);
      expect(after.rows.find((r) => r.code === '9000A')).toMatchObject({ sortCodesSuggested: false, sortCodes: [{ code: '211' }, { code: 'CVS007' }] });
      expect(after.rows.find((r) => r.code === '9000B')).toMatchObject({ sortCodesSuggested: false, sortCodes: [] });
      expect(after.changes.filter((c) => c.sortCodes).map((c) => c.route)).toEqual(['9000B']); // saving the usual ones isn't listed as a change
    }));

  it('dispatchers can add a route from the daily list; elsewhere only the owner can', () =>
    withRollback(async (tx) => {
      await expect(addSortCode(tx, actorAs('dispatcher'), { operation: 'hovership', code: '999' })).rejects.toBeInstanceOf(ForbiddenError);
      const row = await addSortCode(tx, actorAs('dispatcher'), { operation: 'hovership', code: ' 999 ' }, true);
      expect(row.code).toBe('999');
      await expect(addSortCode(tx, actorAs('dispatcher'), { operation: 'hovership', code: '999' }, true)).rejects.toMatchObject({ code: 'sort_code_exists' });
      await expect(addSortCode(tx, actorAs('viewer'), { operation: 'hovership', code: '998' }, true)).rejects.toBeInstanceOf(ForbiddenError);
    }));
});

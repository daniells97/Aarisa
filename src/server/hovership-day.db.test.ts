import { describe, expect, it } from 'vitest';
import { actorAs, withRollback } from '../../tests/helpers/db';
import { ForbiddenError } from './actor';
import { loadHovershipDay, setHovershipRoutes } from './hovership-day';
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
});

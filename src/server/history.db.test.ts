import { describe, expect, it } from 'vitest';
import { historyRange } from '~/domain/history-range';
import { actorAs, driverNamed, withRollback } from '../../tests/helpers/db';
import { loadDay, setSortCodes } from './daily';
import { loadHistory } from './history';

describe('history', () => {
  it('turns a day, week, month or range into dates', () => {
    expect(historyRange('day', '2026-06-18')).toEqual({ from: '2026-06-18', to: '2026-06-18' });
    expect(historyRange('week', '2026-06-18')).toEqual({ from: '2026-06-15', to: '2026-06-21' });
    expect(historyRange('month', '2026-02-10')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(historyRange('range', '2026-06-18', '2026-07-01', '2026-06-01')).toEqual({ from: '2026-06-01', to: '2026-07-01' });
  });

  it('a week of the sample data, by person, and one person on one day with their routes', () =>
    withRollback(async (tx) => {
      const dispatcher = actorAs('dispatcher');
      const week = await loadHistory(tx, dispatcher, { from: '2026-06-15', to: '2026-06-21', operation: 'tforce' }, '2026-07-01');
      expect(week.totals.days).toBeGreaterThan(0);
      expect(week.totals.pieces).toBeGreaterThan(0);
      expect(JSON.stringify(week)).not.toMatch(/Cents/); // no money

      const day = await loadHistory(tx, dispatcher, { from: '2026-06-18', to: '2026-06-18', operation: 'tforce' }, '2026-07-01');
      const row = day.rows.find((r) => r.driverCode === '9000W')!;
      const person = (await driverNamed(tx, row.name!))!;
      const d = await loadDay(tx, actorAs('owner'), '2026-06-18');
      const r9 = d.rows.find((r) => r.code === '9000W')!;
      await setSortCodes(tx, actorAs('owner'), { date: '2026-06-18', routeId: r9.routeId, sortCodeIds: [d.options.sortCodes.find((s) => s.code === '301')!.id] });
      const mine = await loadHistory(tx, dispatcher, { from: '2026-06-18', to: '2026-06-18', driverId: person.id }, '2026-07-01');
      expect(mine.rows).toContainEqual(expect.objectContaining({ driverCode: '9000W', sortCodes: ['301'] }));

      await expect(loadHistory(tx, dispatcher, { from: '2025-01-01', to: '2026-06-18' }, '2026-07-01')).rejects.toMatchObject({ code: 'range_too_long' });
    }));
});

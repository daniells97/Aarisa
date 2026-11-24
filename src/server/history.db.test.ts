import { describe, expect, it } from 'vitest';
import { historyRange } from '~/domain/history-range';
import { actorAs, driverNamed, withRollback } from '../../tests/helpers/db';
import { loadDay, setSortCodes } from './daily';
import { loadHistory } from './history';
import { addDriverNote, addLoan } from './driver-ledger';

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
  it('also shows the extra jobs, loans and notes of the period; amounts only for roles that see money', () =>
    withRollback(async (tx) => {
      const owner = actorAs('owner');
      const day = await loadHistory(tx, owner, { from: '2026-06-18', to: '2026-06-18', operation: 'tforce' }, '2026-07-01');
      const person = (await driverNamed(tx, day.rows.find((r) => r.name)!.name!))!;
      await addLoan(tx, owner, { driverId: person.id, kind: 'advance', amountCents: 5000, givenOn: '2026-06-18', note: 'Gas' });
      await addDriverNote(tx, owner, { driverId: person.id, body: 'Owes the uniform' });
      const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date());
      const mine = await loadHistory(tx, owner, { from: '2026-06-18', to: '2026-06-18', driverId: person.id }, '2026-07-01');
      expect(mine.loans).toEqual([expect.objectContaining({ name: person.fullName, kind: 'advance', amount: 5000, note: 'Gas' })]);
      const notes = await loadHistory(tx, owner, { from: today, to: today, driverId: person.id }, '2026-07-01');
      expect(notes.notes).toEqual([expect.objectContaining({ body: 'Owes the uniform', resolved: false })]);
      const asDispatcher = await loadHistory(tx, actorAs('dispatcher'), { from: '2026-06-18', to: '2026-06-18', driverId: person.id }, '2026-07-01');
      expect(asDispatcher.loans[0]!.amount).toBeNull();
      const june = await loadHistory(tx, owner, { from: '2026-06-18', to: '2026-06-18' }, '2026-07-01');
      expect(june.extraJobs.length).toBeGreaterThan(0);
      expect(june.extraJobs[0]).toEqual(expect.objectContaining({ date: '2026-06-18', service: expect.objectContaining({ name: expect.any(String) }) }));
    }));
});

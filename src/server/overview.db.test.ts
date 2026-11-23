import { describe, expect, it } from 'vitest';
import { HOVERSHIP_CSV, actorAs, clearHovership, withRollback } from '../../tests/helpers/db';
import { importHovership } from './hovership';
import { loadOverview, weeksStartingIn } from './overview';

describe('overview (server)', () => {
  it('shows the June 15 week with Hovership figures and what needs the owner', () =>
    withRollback(async (tx) => {
      await clearHovership(tx);
      await importHovership(tx, actorAs('owner'), { fileName: 'f.csv', text: HOVERSHIP_CSV });
      const o = await loadOverview(tx, actorAs('owner'), '2026-06-22', { week: '2026-06-15' });
      expect(o.figures).toMatchObject({ hovershipPackages: 2_553, hovershipRouteDays: 51, profitCents: 1_222_50 });
      expect(o.hovership.revenueCents).toBe(7_792_00 + 775_00);
      expect(o.needs.map((n) => n.kind).filter((k) => k !== 'tforce_exceptions' && k !== 'late_payment')).toEqual(['run_ready', 'lost_day']);
      expect(o.perDay.reduce((s, d) => s + d.hovership, 0)).toBe(2_553);
      expect(o.figures.tforcePieces).toBe(4_910); // seeded T-Force report for the same week
    }));

  it('gives dispatchers no profit, revenue or lost-money items', () =>
    withRollback(async (tx) => {
      await clearHovership(tx);
      await importHovership(tx, actorAs('owner'), { fileName: 'f.csv', text: HOVERSHIP_CSV });
      const o = await loadOverview(tx, actorAs('dispatcher'), '2026-06-22', { week: '2026-06-15' });
      expect([o.figures.profitCents, o.figures.profitChangePct, o.hovership.revenueCents, o.hovership.profitCents]).toEqual([null, null, null, null]);
      expect(o.needs.some((n) => n.kind === 'lost_day' || n.kind === 'run_ready')).toBe(false);
    }));
});

describe('overview late payments', () => {
  it('money roles see the latest late payment; dispatchers do not', () =>
    withRollback(async (tx) => {
      await clearHovership(tx);
      await importHovership(tx, actorAs('owner'), { fileName: 'f.csv', text: HOVERSHIP_CSV });
      const o = await loadOverview(tx, actorAs('finance'), '2026-07-01', { week: '2026-06-15' });
      expect(o.needs.find((n) => n.kind === 'late_payment')).toMatchObject({ operation: 'hovership', periodStart: '2026-06-01', daysLate: 3 });
      const d = await loadOverview(tx, actorAs('dispatcher'), '2026-07-01', { week: '2026-06-15' });
      expect(d.needs.some((n) => n.kind === 'late_payment')).toBe(false);
    }));
});

describe('overview by month', () => {
  it('a month is the weeks that start in it', () => {
    expect(weeksStartingIn('2026-11')).toEqual(['2026-11-02', '2026-11-09', '2026-11-16', '2026-11-23', '2026-11-30']);
    expect(weeksStartingIn('2026-06')).toEqual(['2026-06-01', '2026-06-08', '2026-06-15', '2026-06-22', '2026-06-29']);
  });

  it('June adds up its weeks: the sample week is part of it', () =>
    withRollback(async (tx) => {
      const week = await loadOverview(tx, actorAs('owner'), '2026-07-01', { week: '2026-06-15' });
      const month = await loadOverview(tx, actorAs('owner'), '2026-07-01', { month: '2026-06' });
      expect(month).toMatchObject({ month: '2026-06', weeks: 5, week: { start: '2026-06-01', end: '2026-07-05' } });
      expect(month.perDay).toHaveLength(35);
      expect(month.figures.packages).toBeGreaterThanOrEqual(week.figures.packages);
      expect(month.figures.routeDays).toBeGreaterThanOrEqual(week.figures.routeDays);
    }));
});

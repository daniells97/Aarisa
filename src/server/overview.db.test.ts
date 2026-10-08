import { describe, expect, it } from 'vitest';
import { HOVERSHIP_CSV, actorAs, clearHovership, withRollback } from '../../tests/helpers/db';
import { importHovership } from './hovership';
import { loadOverview } from './overview';

describe('overview (server)', () => {
  it('shows the June 15 week with Hovership figures and what needs the owner', () =>
    withRollback(async (tx) => {
      await clearHovership(tx);
      await importHovership(tx, actorAs('owner'), { fileName: 'f.csv', text: HOVERSHIP_CSV });
      const o = await loadOverview(tx, actorAs('owner'), '2026-06-22', '2026-06-15');
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
      const o = await loadOverview(tx, actorAs('dispatcher'), '2026-06-22', '2026-06-15');
      expect([o.figures.profitCents, o.figures.profitChangePct, o.hovership.revenueCents, o.hovership.profitCents]).toEqual([null, null, null, null]);
      expect(o.needs.some((n) => n.kind === 'lost_day' || n.kind === 'run_ready')).toBe(false);
    }));
});

describe('overview late payments', () => {
  it('money roles see the latest late payment; dispatchers do not', () =>
    withRollback(async (tx) => {
      await clearHovership(tx);
      await importHovership(tx, actorAs('owner'), { fileName: 'f.csv', text: HOVERSHIP_CSV });
      const o = await loadOverview(tx, actorAs('finance'), '2026-07-01', '2026-06-15');
      expect(o.needs.find((n) => n.kind === 'late_payment')).toMatchObject({ operation: 'hovership', periodStart: '2026-06-01', daysLate: 3 });
      const d = await loadOverview(tx, actorAs('dispatcher'), '2026-07-01', '2026-06-15');
      expect(d.needs.some((n) => n.kind === 'late_payment')).toBe(false);
    }));
});

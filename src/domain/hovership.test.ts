import { describe, expect, it } from 'vitest';
import { hovershipSampleRows } from '../../tests/helpers/hovership-sample';
import { hovershipSummary, type HovershipDay, type RateFn } from './hovership';

// Spec §9 fixtures, from docs/seed/hovership_details_jun2026.csv with the spec §5.1 rates.
const sample = hovershipSampleRows();

const RATES = { t1_3: [300, 250], t4: [200, 175], stat: [1000, 500] } as const;
const rate: RateFn = (item) => ({ ok: true, rateId: item, clientRateId: item, clientCents: RATES[item as keyof typeof RATES][0], driverCents: RATES[item as keyof typeof RATES][1], effectiveFrom: '2026-06-01' });

function period(from: string, to: string) {
  const rows = sample.filter((r) => r.date >= from && r.date <= to);
  const days: HovershipDay[] = rows.map((r) => ({ date: r.date, driverId: r.driverCode, t13: r.t1 + r.t2 + r.t3, t4: r.t4, stat: r.stat, bonusCents: r.bonusCents }));
  return { rows, summary: hovershipSummary(days, rows.reduce((s, r) => s + r.stemCents, 0), rate) };
}

describe('Hovership seed file', () => {
  it('parses all 319 rows without problems', () => {
    expect(sample).toHaveLength(319);
  });

  it('reproduces the week of June 15 to 21 (spec §9)', () => {
    const { totals } = period('2026-06-15', '2026-06-21').summary;
    expect(totals).toMatchObject({
      rows: 51, drivers: 17, t13: 2496, t4: 57, stat: 19,
      bonusCents: 909_75, driverPayCents: 7_344_50, revenueCents: 7_792_00, stemCents: 775_00,
      operationProfitCents: 1_222_50, marginSumCents: 447_50,
    });
  });

  it('reproduces the June 8 to 21 payroll run (spec §9)', () => {
    const { totals } = period('2026-06-08', '2026-06-21').summary;
    expect(totals).toMatchObject({
      rows: 90, drivers: 20, t13: 4525, t4: 101, stat: 43,
      bonusCents: 1_684_75, driverPayCents: 13_389_00, revenueCents: 14_207_00, stemCents: 1_495_00, operationProfitCents: 2_313_00,
    });
  });

  it('matches the Total Route and Total Profit columns on every row', () => {
    const { rows, summary } = period('2026-06-01', '2026-07-10');
    summary.days.forEach((d, i) => {
      const r = rows[i]!;
      expect(d.driverPayCents).toBe(r.totalRouteCents);
      expect(d.marginCents + r.stemCents).toBe(r.totalProfitCents); // the old sheet adds STEM per driver
    });
  });

  it('flags days that lose money once STEM stays at operation level', () => {
    const { lostMoney } = period('2026-06-15', '2026-06-21').summary;
    expect(lostMoney.length).toBeGreaterThan(0);
    expect(lostMoney.every((d) => d.marginCents < 0)).toBe(true);
  });

  it('reports items without a rate instead of valuing them at zero silently', () => {
    const noStat: RateFn = (item, d, date) => (item === 'stat' ? { ok: false, reason: 'missing_rate' } : rate(item, d, date));
    const days: HovershipDay[] = [{ date: '2026-06-15', driverId: 'x', t13: 10, t4: 0, stat: 2, bonusCents: 0 }];
    expect(hovershipSummary(days, 0, noStat).missingRates[0]!.missing).toEqual(['stat']);
  });
});

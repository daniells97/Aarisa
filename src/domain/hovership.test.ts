import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseHovership } from '~/integrations/hovership';
import { hovershipSummary, type HovershipDay, type RateFn } from './hovership';

// Spec §9 fixtures, from docs/seed/hovership_details_jun2026.csv with the spec §5.1 rates.
const csv = readFileSync(new URL('../../docs/seed/hovership_details_jun2026.csv', import.meta.url), 'utf8');
const parsed = parseHovership(csv);
if (parsed.kind !== 'ok') throw new Error('seed file should parse');

const RATES = { t1_3: [300, 250], t4: [200, 175], stat: [1000, 500] } as const;
const rate: RateFn = (item) => ({ ok: true, rateId: item, clientCents: RATES[item][0], driverCents: RATES[item][1], effectiveFrom: '2026-06-01' });

function period(from: string, to: string) {
  const rows = parsed.kind === 'ok' ? parsed.rows.filter((r) => r.date >= from && r.date <= to) : [];
  const days: HovershipDay[] = rows.map((r) => ({ date: r.date, driverId: r.driverCode, t13: r.t1 + r.t2 + r.t3, t4: r.t4, stat: r.stat, bonusCents: r.bonusCents }));
  return { rows, summary: hovershipSummary(days, rows.reduce((s, r) => s + r.stemCents, 0), rate) };
}

describe('Hovership seed file', () => {
  it('parses all 319 rows without problems', () => {
    expect(parsed.rows).toHaveLength(319);
    expect(parsed.problems).toEqual([]);
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

describe('parseHovership', () => {
  it('reads the client column names', () => {
    const text = 'POD Date,DriverCode,DriverNameCode,Tier 1,Tier 2,Tier 3,Tier 4,Stat,Stem,Stem Reason,Bonus,Total Route,Total Profit\n6/15/2026,dub061,Robert Arteaga,1,2,3,0,0,$20.00,Diablo,"$1,000.50",0,0\n';
    const r = parseHovership(text);
    expect(r.kind).toBe('ok');
    if (r.kind === 'ok') expect(r.rows[0]).toMatchObject({ date: '2026-06-15', driverCode: 'DUB061', t1: 1, stemCents: 2000, bonusCents: 100050 });
  });

  it('stops with a suggestion when a column was renamed', () => {
    const text = 'POD Date,Driver #,Tier 1,Tier 2,Tier 3,Tier 4,Stat,Stem,Bonus\n2026-06-15,DUB1,1,0,0,0,0,0,0\n';
    const r = parseHovership(text);
    expect(r).toMatchObject({ kind: 'layout_changed', missing: ['driver_code'] });
    const withMap = parseHovership(text, { driver_code: 'Driver #' });
    expect(withMap.kind).toBe('ok');
  });

  it('lists bad rows as problems', () => {
    const r = parseHovership('pod_date,driver_code,tier1,tier2,tier3,tier4,stat,stem,bonus\nnope,DUB1,1,0,0,0,0,0,0\n2026-06-15,DUB1,x,0,0,0,0,0,0\n');
    expect(r.kind === 'ok' && r.problems.map((p) => p.line)).toEqual([2, 3]);
  });
});

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseHovership } from '~/integrations/hovership';
import { hovershipSummary, type RateFn } from './hovership';
import { buildPayroll, payrollCsv } from './payroll';

const parsed = parseHovership(readFileSync(new URL('../../docs/seed/hovership_details_jun2026.csv', import.meta.url), 'utf8'));
const RATES = { t1_3: [300, 250], t4: [200, 175], stat: [1000, 500] } as const;
const rate: RateFn = (item) => ({ ok: true, rateId: item, clientCents: RATES[item][0], driverCents: RATES[item][1], effectiveFrom: '2026-06-01' });

function run(from: string, to: string, extra: Partial<Parameters<typeof buildPayroll>[0]> = {}) {
  const rows = parsed.kind === 'ok' ? parsed.rows.filter((r) => r.date >= from && r.date <= to) : [];
  const { days } = hovershipSummary(rows.map((r) => ({ date: r.date, driverId: r.driverCode, t13: r.t1 + r.t2 + r.t3, t4: r.t4, stat: r.stat, bonusCents: r.bonusCents })), 0, rate);
  return buildPayroll({
    days, otherRevenueCents: rows.reduce((s, r) => s + r.stemCents, 0),
    expectedWeeks: ['2026-06-08', '2026-06-15'], coveredWeeks: ['2026-06-08', '2026-06-15'], openExceptions: 0, previousDriverIds: null, ...extra,
  });
}

describe('Hovership payroll run June 8 to 21 (spec §9)', () => {
  it('reproduces the run totals', () => {
    const p = run('2026-06-08', '2026-06-21');
    expect(p.totals).toMatchObject({
      drivers: 20, routeDays: 90, packages: 4_626, stops: 43,
      bonusCents: 1_684_75, payCents: 13_389_00, revenueCents: 14_207_00, otherRevenueCents: 1_495_00, profitCents: 2_313_00,
    });
    expect(p.ready).toBe(true);
    expect(p.lines.reduce((s, l) => s + l.payCents, 0)).toBe(13_389_00);
  });

  it('is blocked by a missing report, open exceptions or missing rates (rule 6, §5.5)', () => {
    const p = run('2026-06-15', '2026-06-21', { coveredWeeks: ['2026-06-15'], openExceptions: 2 });
    expect(p.ready).toBe(false);
    expect(p.blockers).toEqual([{ kind: 'missing_report', weeks: ['2026-06-08'] }, { kind: 'open_exceptions', count: 2 }]);
  });

  it('flags drivers who were not in the previous run and negative days', () => {
    const p = run('2026-06-08', '2026-06-21', { previousDriverIds: ['DUB061'] });
    expect(p.warnings.newDrivers).toHaveLength(19);
    expect(p.warnings.negativeDays.length).toBeGreaterThan(0);
  });
});

describe('payroll file', () => {
  it('writes a CSV with escaped names and a total row', () => {
    const csv = payrollCsv({ operation: 'hovership', start: '2026-06-08', end: '2026-06-21' }, [
      { name: 'Arteaga, Robert', code: 'DUB061', payee: 'driver', routeDays: 10, packages: 600, stops: 2, bonusCents: 400_00, payCents: 1_900_25 },
    ]);
    const lines = csv.trim().split('\r\n');
    expect(lines[0]).toBe('operation,period_start,period_end,payee,name,code,route_days,packages,stops,bonus,pay');
    expect(lines[1]).toBe('hovership,2026-06-08,2026-06-21,driver,"Arteaga, Robert",DUB061,10,600,2,400.00,1900.25');
    expect(lines[2]).toContain('total');
    expect(lines[2]?.endsWith('1900.25')).toBe(true);
  });
});

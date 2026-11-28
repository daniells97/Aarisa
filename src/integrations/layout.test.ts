import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { REPORT_LAYOUTS } from '~/db/seed-data';
import { headerKey, parseWithLayout, type LayoutColumn } from './layout';

// The saved layouts of the two clients, with ids standing for the database rows.
const cols = (op: string): LayoutColumn[] => REPORT_LAYOUTS[op]!.map((c) => ({
  id: c.sourceName, sourceName: c.sourceName, aliases: c.aliases, meaning: c.meaning, required: c.required,
  serviceTypeId: c.service ?? null, tierId: c.tier ?? null, revenueTypeId: c.revenueType ?? null,
}));
const read = (f: string) => readFileSync(new URL(`../../docs/seed/${f}`, import.meta.url), 'utf8');

describe('parseWithLayout', () => {
  it('matches headers without case, spaces or punctuation', () => {
    expect(headerKey('POD Date')).toBe(headerKey('pod_date'));
    expect(headerKey('Paid Driver #')).toBe(headerKey('paid_driver'));
  });

  it('reads the Hovership report as the client sends it, one row per day and driver code', () => {
    const r = parseWithLayout('POD Date,DriverCode,DriverNameCode,Tier 1,Tier 2,Tier 3,Tier 4,Stat,Stem,Stem Reason\n6/1/2026,dub006,Nayibi Perez,0,43,7,0,0,20,Diablo\n', cols('hovership'), 'driver_code');
    expect(r).toMatchObject({ kind: 'ok', problems: [], rows: [{
      date: '2026-06-01', driverCode: 'DUB006', driverName: 'Nayibi Perez', bonusCents: 0, expectedPayCents: null,
      quantities: { 'Tier 1': 0, 'Tier 2': 43, 'Tier 3': 7, 'Tier 4': 0, Stat: 0 }, otherRevenue: { Stem: 2000 }, otherRevenueReason: 'Diablo',
    }] });
  });

  it('reads amounts written with a dollar sign and thousands', () => {
    const r = parseWithLayout('POD Date,DriverCode,Tier 1,Tier 2,Tier 3,Tier 4,Stat,Stem,Bonus\n6/15/2026,dub061,1,2,3,0,0,$20.00,"$1,000.50"\n', cols('hovership'), 'driver_code');
    expect(r).toMatchObject({ kind: 'ok', rows: [{ driverCode: 'DUB061', otherRevenue: { Stem: 2000 }, bonusCents: 100050 }] });
  });

  it('reads the June 2026 workbook sample: 319 driver-days with bonus and Total Route', () => {
    const r = parseWithLayout(read('hovership_details_jun2026.csv'), cols('hovership'), 'driver_code');
    if (r.kind !== 'ok') throw new Error('should parse');
    expect(r.rows).toHaveLength(319);
    expect(r.rows.reduce((s, x) => s + x.bonusCents, 0)).toBe(478_700);
    expect(r.raw).toHaveLength(319);
  });

  it('reads the T-Force report by route and adds up a route split in two rows', () => {
    const sample = parseWithLayout(read('tforce_pieces_jun2026.csv'), cols('tforce'), 'route_code');
    if (sample.kind !== 'ok') throw new Error('should parse');
    expect(sample.rows).toHaveLength(74);
    expect(sample.rows.reduce((s, x) => s + x.quantities.Pieces!, 0)).toBe(4910);
    const r = parseWithLayout('Order Date,Paid Driver #,Pieces\n6/15/2026,9000a,40\n06/15/2026,9000A,"1,005"\n', cols('tforce'), 'route_code');
    expect(r).toMatchObject({ kind: 'ok', rows: [{ date: '2026-06-15', routeCode: '9000A', quantities: { Pieces: 1045 }, lines: [2, 3] }] });
  });

  it('stops with a suggestion when a required column was renamed, and goes on once it is confirmed', () => {
    const text = 'Order Date,Driver #,Pieces\n2026-06-15,9000A,40\n';
    expect(parseWithLayout(text, cols('tforce'), 'route_code')).toMatchObject({ kind: 'layout_changed', missing: ['Paid Driver #'], suggestions: [{ column: 'Paid Driver #', header: 'Driver #' }] });
    expect(parseWithLayout(text, cols('tforce'), 'route_code', { 'Paid Driver #': 'Driver #' }).kind).toBe('ok');
    expect(parseWithLayout('POD Date,DriverCode,Tier 1,Tier 2,Tier 3,Stat,Stem\n2026-06-01,DUB006,0,43,7,0,20\n', cols('hovership'), 'driver_code'))
      .toMatchObject({ kind: 'layout_changed', missing: ['Tier 4'] });
  });

  it('keeps bad lines apart, with the reason, and reads the rest', () => {
    const r = parseWithLayout('Order Date,Paid Driver #,Pieces\nsoon,9000A,4\n2026-06-15,,4\n2026-06-15,9000B,x\n2026-06-15,9000C,5\n', cols('tforce'), 'route_code');
    if (r.kind !== 'ok') throw new Error('should parse');
    expect(r.rows.map((x) => x.routeCode)).toEqual(['9000C']);
    expect(r.problems.map((p) => p.line)).toEqual([2, 3, 4]);
    expect(r.raw.filter((x) => x.problem)).toHaveLength(3);
  });
});

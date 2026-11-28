import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseCsvObjects } from '~/integrations/csv';
import { crossCheck, pieceGrid, type ListEntry, type ReportRow } from './tforce';

const read = (f: string) => parseCsvObjects(readFileSync(new URL(`../../docs/seed/${f}`, import.meta.url), 'utf8')).records;
const report: ReportRow[] = read('tforce_pieces_jun2026.csv').map((r) => ({ date: r.order_date!, route: r.paid_driver!, pieces: Number(r.pieces) }));
const list: ListEntry[] = read('tforce_daily_list_sample.csv').map((r) => ({
  date: r.date!, route: r.route!, rawName: r.raw_name || null,
  payee: r.driver_or_contractor ? (r.driver_or_contractor.startsWith('CONTRACTOR:') ? { contractorId: r.driver_or_contractor.slice(11) } : { driverId: r.driver_or_contractor }) : null,
}));

describe('T-Force June 15 to 20 (spec §9)', () => {
  it('has 74 route-days, 19 routes and 4,910 pieces with the right daily totals', () => {
    expect(report).toHaveLength(74);
    const days = ['2026-06-15', '2026-06-16', '2026-06-17', '2026-06-18', '2026-06-19', '2026-06-20'];
    const grid = pieceGrid(report, days);
    expect(grid).toHaveLength(19);
    const daily = days.map((_, i) => grid.reduce((s, g) => s + (g.cells[i] ?? 0), 0));
    expect(daily).toEqual([1112, 870, 774, 796, 740, 618]);
    expect(grid.reduce((s, g) => s + g.total, 0)).toBe(4910);
  });

  it('finds exactly the three sample exceptions', () => {
    const { matched, exceptions } = crossCheck(report, list);
    expect(exceptions.map((e) => [e.type, e.route, e.date, 'pieces' in e ? e.pieces : null])).toEqual([
      ['low_pieces', '9000W', '2026-06-18', 1],
      ['unknown_name', '9000Z', '2026-06-18', 34],
      ['low_pieces', '9000Z', '2026-06-19', 1],
    ]);
    expect(exceptions[1]).toMatchObject({ rawName: 'the new guy from Puma' });
    expect(matched).toHaveLength(73);
    expect(matched.filter((m) => m.payee.contractorId === 'Puma')).toHaveLength(10);
  });

  it('flags a list entry with no report row as no_pieces, and a blank entry as no_driver', () => {
    const r: ReportRow[] = [{ date: 'd1', route: 'A', pieces: 50 }];
    const l: ListEntry[] = [{ date: 'd1', route: 'A', payee: null, rawName: null }, { date: 'd2', route: 'A', payee: { driverId: 'x' }, rawName: null }];
    expect(crossCheck(r, l).exceptions.map((e) => e.type)).toEqual(['no_driver', 'no_pieces']);
  });

  it('uses four weeks of history for the usual range when there is enough', () => {
    const history: ReportRow[] = [80, 82, 90, 85].map((p, i) => ({ date: `h${i}`, route: 'A', pieces: p }));
    const r: ReportRow[] = [{ date: 'd1', route: 'A', pieces: 7 }];
    const l: ListEntry[] = [{ date: 'd1', route: 'A', payee: { driverId: 'x' }, rawName: null }];
    expect(crossCheck(r, l, history).exceptions).toMatchObject([{ type: 'low_pieces', median: 83.5 }]);
    expect(crossCheck(r, l, []).exceptions).toEqual([]); // one day alone has nothing to compare with
  });
});

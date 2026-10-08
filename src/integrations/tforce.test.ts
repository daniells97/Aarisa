import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseTforce } from './tforce';

describe('parseTforce', () => {
  it('reads the June 15 to 20 sample: 74 route-days, 4,910 pieces', () => {
    const r = parseTforce(readFileSync(new URL('../../docs/seed/tforce_pieces_jun2026.csv', import.meta.url), 'utf8'));
    expect(r.kind).toBe('ok');
    if (r.kind !== 'ok') return;
    expect(r.rows).toHaveLength(74);
    expect(r.rows.reduce((s, x) => s + x.pieces, 0)).toBe(4910);
    expect(r.problems).toEqual([]);
  });

  it('reads the client column names and adds up a route split in two rows', () => {
    const r = parseTforce('Order Date,Paid Driver #,Pieces\n6/15/2026,9000a,40\n06/15/2026,9000A,"1,005"\n');
    expect(r).toMatchObject({ kind: 'ok', rows: [{ date: '2026-06-15', route: '9000A', pieces: 1045 }] });
  });

  it('stops with a suggestion when "Paid Driver #" was renamed (design 6.12)', () => {
    const r = parseTforce('Order Date,Driver #,Pieces\n2026-06-15,9000A,40\n');
    expect(r).toMatchObject({ kind: 'layout_changed', missing: ['route'], suggestions: [{ field: 'route', header: 'Driver #' }] });
    expect(parseTforce('Order Date,Driver #,Pieces\n2026-06-15,9000A,40\n', { route: 'Driver #' }).kind).toBe('ok');
  });
});

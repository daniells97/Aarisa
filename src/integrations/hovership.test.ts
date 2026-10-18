import { describe, expect, it } from 'vitest';
import { parseHovership } from './hovership';

describe('parseHovership', () => {
  it('reads the report exactly as Hovership sends it, with no bonus or totals', () => {
    const r = parseHovership('POD Date,DriverCode,DriverNameCode,Tier 1,Tier 2,Tier 3,Tier 4,Stat,Stem,Stem Reason\n6/1/2026,dub006,Nayibi Perez,0,43,7,0,0,20,Diablo\n');
    expect(r).toMatchObject({
      kind: 'ok',
      problems: [],
      rows: [{ date: '2026-06-01', driverCode: 'DUB006', t2: 43, t3: 7, stemCents: 2000, stemReason: 'Diablo', bonusCents: 0, totalRouteCents: null }],
    });
  });

  it('still stops when a tier column is missing', () => {
    const r = parseHovership('POD Date,DriverCode,Tier 1,Tier 2,Tier 3,Stat,Stem\n2026-06-01,DUB006,0,43,7,0,20\n');
    expect(r).toMatchObject({ kind: 'layout_changed', missing: ['tier4'] });
  });
});

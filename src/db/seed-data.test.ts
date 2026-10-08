import { describe, expect, it } from 'vitest';
import { OPERATIONS, RATES, SERVICE_TYPES } from './seed-data';

describe('seed master data', () => {
  it('has the two operations with their own pay cycles (rule 8)', () => {
    expect(OPERATIONS.map((o) => [o.code, o.payCycle])).toEqual([['hovership', 'biweekly'], ['tforce', 'weekly']]);
  });
  it('uses the Hovership rates from spec §5.1 in cents', () => {
    const r = (s: string, t: string | null) => RATES.find((x) => x.service === s && x.tier === t);
    expect(r('hovership_packages', 't1_3')).toMatchObject({ client: 300, driver: 250 });
    expect(r('hovership_packages', 't4')).toMatchObject({ client: 200, driver: 175 });
    expect(r('stat', null)).toMatchObject({ client: 1000, driver: 500 });
    expect(r('pharma_pickup', null)).toMatchObject({ client: 5000, driver: null });
  });
  it('covers the closed service list', () => {
    expect(new Set(SERVICE_TYPES.map((s) => s.code))).toEqual(new Set([
      'ecommerce', 'hovership_packages', 'stat', 'pharma_pickup', 'pickup', 'grainger', 'recovery_route', 'other',
    ]));
  });
});

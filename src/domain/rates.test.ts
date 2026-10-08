import { describe, expect, it } from 'vitest';
import { currentGeneralRates, rateFor, type RateRow } from './rates';

const row = (p: Partial<RateRow> & Pick<RateRow, 'id' | 'effectiveFrom'>): RateRow => ({
  serviceTypeId: 'pkg', tier: 't1_3', driverId: null, contractorId: null, clientRateCents: 300, driverRateCents: 250, ...p,
});

const rates: RateRow[] = [
  row({ id: 'jun', effectiveFrom: '2026-06-01' }),
  row({ id: 'aug', effectiveFrom: '2026-08-01', clientRateCents: 320, driverRateCents: 260 }),
  row({ id: 't4', tier: 't4', effectiveFrom: '2026-06-01', clientRateCents: 200, driverRateCents: 175 }),
  row({ id: 'robert', driverId: 'robert', effectiveFrom: '2026-07-01', driverRateCents: 275 }),
  row({ id: 'puma', contractorId: 'puma', effectiveFrom: '2026-06-01', driverRateCents: 240 }),
  row({ id: 'pharma', serviceTypeId: 'pharma', tier: null, effectiveFrom: '2026-06-01', clientRateCents: 5000, driverRateCents: null }),
];

describe('rateFor', () => {
  it('uses the rate valid on the work date, never a later one', () => {
    expect(rateFor(rates, 'pkg', 't1_3', {}, '2026-06-15')).toMatchObject({ ok: true, rateId: 'jun', driverCents: 250 });
    expect(rateFor(rates, 'pkg', 't1_3', {}, '2026-07-31')).toMatchObject({ rateId: 'jun' });
    expect(rateFor(rates, 'pkg', 't1_3', {}, '2026-08-01')).toMatchObject({ rateId: 'aug', clientCents: 320 });
  });
  it('keeps tiers apart', () => {
    expect(rateFor(rates, 'pkg', 't4', {}, '2026-06-15')).toMatchObject({ rateId: 't4', driverCents: 175 });
  });
  it('prefers a driver override from its start date, then the contractor override', () => {
    expect(rateFor(rates, 'pkg', 't1_3', { driverId: 'robert' }, '2026-06-30')).toMatchObject({ rateId: 'jun' });
    expect(rateFor(rates, 'pkg', 't1_3', { driverId: 'robert' }, '2026-07-01')).toMatchObject({ rateId: 'robert', driverCents: 275 });
    expect(rateFor(rates, 'pkg', 't1_3', { contractorId: 'puma' }, '2026-06-15')).toMatchObject({ rateId: 'puma' });
  });
  it('reports a missing rate before the first rate or without a driver amount', () => {
    expect(rateFor(rates, 'pkg', 't1_3', {}, '2026-05-31')).toEqual({ ok: false, reason: 'missing_rate' });
    expect(rateFor(rates, 'pharma', null, {}, '2026-06-15')).toEqual({ ok: false, reason: 'missing_rate' });
  });
});

describe('currentGeneralRates', () => {
  it('returns one general rate per service and tier', () => {
    expect(currentGeneralRates(rates, '2026-08-15').map((r) => r.id).sort()).toEqual(['aug', 'pharma', 't4']);
  });
});

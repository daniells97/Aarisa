import { describe, expect, it } from 'vitest';
import { rateFor, rateTimeline, type RateRow } from './rates';

const row = (p: Partial<RateRow> & Pick<RateRow, 'id' | 'effectiveFrom' | 'side' | 'rateCents'>): RateRow => ({
  serviceTypeId: 'pkg', tierId: 'T2', payeeId: null, ...p,
});

const rates: RateRow[] = [
  row({ id: 'jun-c', side: 'client', effectiveFrom: '2026-06-01', rateCents: 300 }),
  row({ id: 'jun-p', side: 'payee', effectiveFrom: '2026-06-01', rateCents: 250 }),
  row({ id: 'aug-c', side: 'client', effectiveFrom: '2026-08-01', rateCents: 320 }), // client renegotiated, driver pay unchanged
  row({ id: 't4-c', tierId: 'T4', side: 'client', effectiveFrom: '2026-06-01', rateCents: 200 }),
  row({ id: 't4-p', tierId: 'T4', side: 'payee', effectiveFrom: '2026-06-01', rateCents: 175 }),
  row({ id: 'robert', side: 'payee', payeeId: 'robert', effectiveFrom: '2026-07-01', rateCents: 275 }),
  row({ id: 'puma', side: 'payee', payeeId: 'puma', effectiveFrom: '2026-06-01', rateCents: 240 }),
  row({ id: 'pharma-c', serviceTypeId: 'pharma', tierId: null, side: 'client', effectiveFrom: '2026-06-01', rateCents: 5000 }),
];

describe('rateFor', () => {
  it('uses the rate valid on the work date, never a later one, on each side', () => {
    expect(rateFor(rates, 'pkg', 'T2', null, '2026-06-15')).toMatchObject({ ok: true, rateId: 'jun-p', clientRateId: 'jun-c', clientCents: 300, driverCents: 250 });
    expect(rateFor(rates, 'pkg', 'T2', null, '2026-07-31')).toMatchObject({ clientCents: 300 });
    expect(rateFor(rates, 'pkg', 'T2', null, '2026-08-01')).toMatchObject({ rateId: 'jun-p', clientRateId: 'aug-c', clientCents: 320, driverCents: 250 });
  });
  it('keeps tiers apart', () => {
    expect(rateFor(rates, 'pkg', 'T4', null, '2026-06-15')).toMatchObject({ rateId: 't4-p', driverCents: 175, clientCents: 200 });
  });
  it('prefers a special rate for the payee from its start date', () => {
    expect(rateFor(rates, 'pkg', 'T2', 'robert', '2026-06-30')).toMatchObject({ rateId: 'jun-p' });
    expect(rateFor(rates, 'pkg', 'T2', 'robert', '2026-07-01')).toMatchObject({ rateId: 'robert', driverCents: 275, clientCents: 300 });
    expect(rateFor(rates, 'pkg', 'T2', 'puma', '2026-06-15')).toMatchObject({ rateId: 'puma', driverCents: 240 });
  });
  it('reports a missing rate before the first rate or without a payee-side rate', () => {
    expect(rateFor(rates, 'pkg', 'T2', null, '2026-05-31')).toEqual({ ok: false, reason: 'missing_rate' });
    expect(rateFor(rates, 'pharma', null, null, '2026-06-15')).toEqual({ ok: false, reason: 'missing_rate' });
  });
});

describe('rateTimeline', () => {
  it('puts both sides on one line per date, carrying the unchanged side forward', () => {
    const t2 = rateTimeline(rates, '2026-08-15').find((t) => t.tierId === 'T2')!;
    expect(t2.steps).toEqual([
      { serviceTypeId: 'pkg', tierId: 'T2', effectiveFrom: '2026-06-01', clientCents: 300, driverCents: 250, changed: ['client', 'payee'] },
      { serviceTypeId: 'pkg', tierId: 'T2', effectiveFrom: '2026-08-01', clientCents: 320, driverCents: 250, changed: ['client'] },
    ]);
    expect(t2.current?.effectiveFrom).toBe('2026-08-01');
    expect(rateTimeline(rates, '2026-07-01').find((t) => t.tierId === 'T2')!.current?.clientCents).toBe(300);
  });
});

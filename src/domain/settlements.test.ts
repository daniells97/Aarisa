import { describe, expect, it } from 'vitest';
import { settlementStatus, settlementSummary } from './settlements';

const line = (p: Partial<Parameters<typeof settlementStatus>[0]> = {}) => ({ expectedCents: 8_271_20, expectedDate: '2026-06-19', receivedCents: 0, claim: 'none' as const, ...p });

describe('settlementStatus (spec §5.6)', () => {
  it('open before the expected date, late after it', () => {
    expect(settlementStatus(line(), '2026-06-19')).toEqual({ status: 'open', missingCents: 8_271_20, daysLate: 0 });
    expect(settlementStatus(line(), '2026-06-22')).toEqual({ status: 'late', missingCents: 8_271_20, daysLate: 3 });
  });
  it('paid in full, short when part arrived', () => {
    expect(settlementStatus(line({ receivedCents: 8_271_20 }), '2026-06-22').status).toBe('paid');
    expect(settlementStatus(line({ receivedCents: 8_000_00 }), '2026-06-22')).toMatchObject({ status: 'short', missingCents: 271_20 });
  });
  it('a claim takes over until the money arrives', () => {
    expect(settlementStatus(line({ claim: 'ready' }), '2026-06-22').status).toBe('claim_ready');
    expect(settlementStatus(line({ claim: 'sent' }), '2026-06-22').status).toBe('claimed');
    expect(settlementStatus(line({ claim: 'sent', receivedCents: 8_271_20 }), '2026-06-22').status).toBe('paid');
  });
  it('an unknown amount (rates not loaded) is open with nothing missing yet', () => {
    expect(settlementStatus(line({ expectedCents: null, expectedDate: '2026-07-20' }), '2026-06-22')).toEqual({ status: 'open', missingCents: null, daysLate: 0 });
  });
});

describe('settlementSummary', () => {
  it('splits not-yet-due from late and counts work paid out but not collected', () => {
    const lines = [
      { ...line(), operation: 'hovership', kind: 'hovership_invoice', paidToPayee: true }, // late $8,271.20
      { ...line({ expectedCents: 9_919_40, expectedDate: '2026-06-26' }), operation: 'hovership', kind: 'hovership_invoice', paidToPayee: false },
      { ...line({ expectedCents: 180_00, expectedDate: '2026-07-18', claim: 'ready' }), operation: 'tforce', kind: 'extra_job', paidToPayee: true },
      { ...line({ expectedCents: null, expectedDate: '2026-07-20' }), operation: 'tforce', kind: 'tforce_weekly', paidToPayee: false },
    ];
    const s = settlementSummary(lines, '2026-06-22', { start: '2026-05-01', end: '2026-05-31' }, [{ date: '2026-05-22', amountCents: 17_614_50 }, { date: '2026-06-02', amountCents: 1 }]);
    expect(s).toMatchObject({ expectedNotDue: 9_919_40 + 180_00, late: 8_271_20, lateCount: 1, unknownAmounts: 1, paidNotByClient: 2, receivedInMonth: 17_614_50 });
  });
});

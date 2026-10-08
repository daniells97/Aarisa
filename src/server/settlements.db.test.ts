import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { contractors } from '~/db/schema';
import { HOVERSHIP_CSV, actorAs, clearHovership, clearTforceReports, withRollback } from '../../tests/helpers/db';
import { ForbiddenError } from './actor';
import { createExtraJob } from './extra-jobs';
import { importHovership } from './hovership';
import { claimDetails, loadSettlements, markClaimReady, markClaimSent, recordPayment } from './settlements';

const owner = actorAs('owner');
const finance = actorAs('finance');

async function hovership(tx: Parameters<Parameters<typeof withRollback>[0]>[0]) {
  await clearHovership(tx);
  await importHovership(tx, owner, { fileName: 'h.csv', text: HOVERSHIP_CSV });
  return loadSettlements(tx, finance, '2026-07-01', 'hovership');
}

describe('settlements (server)', () => {
  it('each Hovership week becomes an expected invoice: Jun 15 to 21 is $8,567.00 (revenue plus STEM), due 21 days after', () =>
    withRollback(async (tx) => {
      const s = await hovership(tx);
      const wk = s.lines.find((l) => l.kind === 'hovership_invoice' && l.periodStart === '2026-06-15')!;
      expect(wk).toMatchObject({ expectedCents: 7_792_00 + 775_00, expectedDate: '2026-07-12', status: 'open', receivedCents: 0 });
      const first = s.lines.find((l) => l.periodStart === '2026-06-01')!;
      expect(first).toMatchObject({ status: 'late', daysLate: 3 }); // due Jun 28
    }));

  it('a payment pays lines in full or leaves them short, and shows in the summary', () =>
    withRollback(async (tx) => {
      const s = await hovership(tx);
      const a = s.lines.find((l) => l.periodStart === '2026-06-01')!;
      const b = s.lines.find((l) => l.periodStart === '2026-06-08')!;
      await recordPayment(tx, finance, {
        operation: 'hovership', receivedOn: '2026-06-30', amountCents: a.expectedCents! + 1_000_00, method: 'ACH', reference: 'ACH 123', note: null,
        allocations: [{ lineId: a.id, amountCents: a.expectedCents! }, { lineId: b.id, amountCents: 1_000_00 }],
      });
      const after = await loadSettlements(tx, finance, '2026-07-01', 'hovership');
      expect(after.lines.find((l) => l.id === a.id)).toMatchObject({ status: 'paid', paidOn: '2026-06-30', missingCents: 0 });
      expect(after.lines.find((l) => l.id === b.id)).toMatchObject({ status: 'short', missingCents: b.expectedCents! - 1_000_00 });
      const july = await loadSettlements(tx, finance, '2026-07-15', 'hovership');
      expect(july.summary.receivedInMonth).toBe(a.expectedCents! + 1_000_00);
    }));

  it('refuses allocations larger than the payment or to another client', () =>
    withRollback(async (tx) => {
      const s = await hovership(tx);
      const a = s.lines[0]!;
      await expect(recordPayment(tx, finance, { operation: 'hovership', receivedOn: '2026-06-30', amountCents: 100, method: null, reference: null, note: null, allocations: [{ lineId: a.id, amountCents: 200 }] }))
        .rejects.toMatchObject({ code: 'allocations_exceed_payment' });
      await expect(recordPayment(tx, finance, { operation: 'tforce', receivedOn: '2026-06-30', amountCents: 100, method: null, reference: null, note: null, allocations: [{ lineId: a.id, amountCents: 100 }] }))
        .rejects.toMatchObject({ code: 'line_not_found' });
    }));

  it('an extra job left out of the settlement is claimed with its order number and agreement', () =>
    withRollback(async (tx) => {
      await clearTforceReports(tx);
      const [puma] = await tx.select().from(contractors).where(eq(contractors.name, 'Puma'));
      const { job } = await createExtraJob(tx, owner, { clientUuid: randomUUID(), service: 'recovery_route', date: '2026-06-18', nearRouteId: null, payee: { contractorId: puma!.id }, clientAmountCents: 180_00, driverAmountCents: 120_00, orderNumber: 'TF-55821', note: 'Agreed with T-Force dispatch by phone' });
      let s = await loadSettlements(tx, finance, '2026-07-01', 'tforce');
      const line = s.lines.find((l) => l.job?.orderNumber === 'TF-55821')!;
      expect(line).toMatchObject({ status: 'open', expectedCents: 180_00, job: { payee: 'Puma', contractor: true, payeeAmountCents: 120_00 } });
      await markClaimReady(tx, finance, line.id);
      const details = await claimDetails(tx, finance, line.id, '2026-07-01');
      expect(details.checklist).toEqual({ orderNumber: true, agreementLogged: true, sent: false });
      await markClaimSent(tx, finance, line.id, 'settlements@tforce.example');
      s = await loadSettlements(tx, finance, '2026-07-01', 'tforce');
      expect(s.lines.find((l) => l.id === line.id)).toMatchObject({ status: 'claimed', claimSentTo: 'settlements@tforce.example' });
      void job;
    }));

  it('roles: dispatchers see no settlements; viewers read but cannot record (rule 9)', () =>
    withRollback(async (tx) => {
      const s = await hovership(tx);
      await expect(loadSettlements(tx, actorAs('dispatcher'), '2026-07-01')).rejects.toBeInstanceOf(ForbiddenError);
      expect((await loadSettlements(tx, actorAs('viewer'), '2026-07-01')).canRecord).toBe(false);
      await expect(recordPayment(tx, actorAs('viewer'), { operation: 'hovership', receivedOn: '2026-06-30', amountCents: 1, method: null, reference: null, note: null, allocations: [] })).rejects.toBeInstanceOf(ForbiddenError);
      await expect(markClaimReady(tx, actorAs('dispatcher'), s.lines[0]!.id)).rejects.toBeInstanceOf(ForbiddenError);
    }));
});

describe('settlements filter', () => {
  it('payments follow the client filter', () =>
    withRollback(async (tx) => {
      await clearHovership(tx);
      await importHovership(tx, owner, { fileName: 'h.csv', text: HOVERSHIP_CSV });
      await recordPayment(tx, finance, { operation: 'hovership', receivedOn: '2026-06-30', amountCents: 100, method: null, reference: 'x', note: null, allocations: [] });
      expect((await loadSettlements(tx, finance, '2026-07-01', 'hovership')).payments.length).toBeGreaterThan(0);
      expect((await loadSettlements(tx, finance, '2026-07-01', 'tforce')).payments.every((p) => p.operation === 'tforce')).toBe(true);
    }));
});

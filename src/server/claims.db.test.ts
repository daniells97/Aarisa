import { describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { claims, payAdjustments, serviceTypes, settlementLines } from '~/db/schema';
import { todayLA } from '~/domain/dates';
import { periodFor } from '~/domain/periods';
import { TFORCE_CSV, actorAs, clearTforceReports, withRollback } from '../../tests/helpers/db';
import { ForbiddenError } from './actor';
import { respondToClaim } from './claims';
import { getOperation } from './ops';
import { loadRun } from './payroll';
import { markClaimSent } from './settlements';
import { addRate } from './setup';
import { importTforce, loadTforceWeek, resolveTforceException } from './tforce';

// June 15 to 20 sample week (pnpm db:seed): 9000W on Thursday the 18th has 1 piece; it usually has 69 to 95.
const WEEK = '2026-06-15';
const owner = actorAs('owner');
type Tx = Parameters<Parameters<typeof withRollback>[0]>[0];

async function lowW(tx: Tx) {
  await clearTforceReports(tx);
  // T-Force rates aren't confirmed yet (open question 4): an example rate for these tests only.
  const op = await getOperation(tx, 'tforce');
  const [ecom] = await tx.select().from(serviceTypes).where(and(eq(serviceTypes.operationId, op.id), eq(serviceTypes.code, 'ecommerce')));
  await addRate(tx, owner, { serviceTypeId: ecom!.id, tierId: null, clientRateCents: 250, driverRateCents: 180, effectiveFrom: '2026-01-01' });
  await importTforce(tx, owner, { fileName: 'tforce_pieces_jun2026.csv', text: TFORCE_CSV });
  const week = await loadTforceWeek(tx, owner, WEEK);
  return { week, ex: week.exceptions.find((e) => e.route === '9000W' && e.status === 'open')! };
}
const karandeep = async (tx: Tx, runId: string) => (await loadRun(tx, owner, runId)).lines.find((l) => l.name === 'Karandeep Kaur');

describe('claims from the weekly check (server)', () => {
  it('the owner sees what was reported, the usual pieces and the rates; a dispatcher sees no client rate', () =>
    withRollback(async (tx) => {
      const { ex } = await lowW(tx);
      expect(ex.basis).toMatchObject({ reported: 1, hasPayee: true });
      expect(ex.basis!.usual).toBeGreaterThanOrEqual(69);
      expect(ex.basis!.suggestedQuantity).toBe(ex.basis!.usual - 1);
      expect(ex.basis!.clientRateCents).toBeGreaterThan(0);
      const asDispatcher = await loadTforceWeek(tx, actorAs('dispatcher'), WEEK);
      expect(asDispatcher.canPayOther).toBe(false);
      expect(asDispatcher.exceptions.find((e) => e.id === ex.id)!.basis).toMatchObject({ clientRateCents: null, payeeRateCents: null });
    }));

  it('"Pay another amount" is the owner\'s: the difference × the driver rate goes into that week\'s payroll', () =>
    withRollback(async (tx) => {
      const { ex } = await lowW(tx);
      await expect(resolveTforceException(tx, actorAs('dispatcher'), ex.id, { action: 'pay_other', payQuantity: 80 })).rejects.toBeInstanceOf(ForbiddenError);
      const before = (await karandeep(tx, `tforce-${WEEK}`))!;
      await resolveTforceException(tx, owner, ex.id, { action: 'pay_other', payQuantity: 80 });
      const after = (await karandeep(tx, `tforce-${WEEK}`))!;
      expect(after.payCents - before.payCents).toBe(79 * ex.basis!.payeeRateCents!);
      expect(after.routeDays).toBe(before.routeDays);
    }));

  it('"Ask T-Force" opens a claim; the answer sets what is expected and the owner\'s extra pay lands in the open payroll', () =>
    withRollback(async (tx) => {
      const { ex } = await lowW(tx);
      const weekBefore = (await karandeep(tx, `tforce-${WEEK}`))!;
      // A dispatcher can ask, keeping what was reported; the amount comes from the client rate.
      await resolveTforceException(tx, actorAs('dispatcher'), ex.id, { action: 'ask_client', claimQuantity: 80, payQuantity: 1, note: 'driver has photos' });
      const [line] = await tx.select().from(settlementLines).where(eq(settlementLines.kind, 'claim_adjustment'));
      expect(line).toMatchObject({ expectedCents: 80 * ex.basis!.clientRateCents!, status: 'claim_ready' });
      expect(line!.reference).toContain('9000W 2026-06-18');
      expect((await karandeep(tx, `tforce-${WEEK}`))!.payCents).toBe(weekBefore.payCents);

      await markClaimSent(tx, owner, line!.id, 'settlements@tforce.example');
      const rows = await tx.select().from(claims).where(eq(claims.settlementLineId, line!.id));
      expect(rows).toHaveLength(1); // the draft became the sent claim
      expect(rows[0]).toMatchObject({ status: 'sent', claimedQuantity: 80, note: 'driver has photos' });

      // Finance records answers but doesn't decide driver pay.
      await expect(respondToClaim(tx, actorAs('finance'), line!.id, { response: 'partial', acceptedCents: 100_00, payeeCents: 50_00 })).rejects.toBeInstanceOf(ForbiddenError);
      const op = await getOperation(tx, 'tforce');
      const open = periodFor(op.cycleAnchor, op.payCycle, todayLA()).start;
      const openBefore = (await karandeep(tx, `tforce-${open}`))?.payCents ?? 0;
      await respondToClaim(tx, owner, line!.id, { response: 'partial', acceptedCents: 100_00, payeeCents: 50_00 });

      const [lineAfter] = await tx.select().from(settlementLines).where(eq(settlementLines.id, line!.id));
      expect(lineAfter!.expectedCents).toBe(100_00);
      const [answered] = await tx.select().from(claims).where(eq(claims.settlementLineId, line!.id));
      expect(answered).toMatchObject({ response: 'partial', acceptedCents: 100_00, status: 'resolved' });
      const [adj] = await tx.select().from(payAdjustments).where(eq(payAdjustments.id, answered!.payAdjustmentId!));
      expect(adj).toMatchObject({ amountCents: 50_00 });
      expect(adj!.payPeriodId).not.toBeNull();
      // Paid in the open period, not in the closed week; it adds pay but no route-day.
      expect((await karandeep(tx, `tforce-${WEEK}`))!.payCents).toBe(weekBefore.payCents);
      const openAfter = (await karandeep(tx, `tforce-${open}`))!;
      expect(openAfter.payCents - openBefore).toBe(50_00);
      await expect(respondToClaim(tx, owner, line!.id, { response: 'rejected', acceptedCents: null, payeeCents: null })).rejects.toMatchObject({ code: 'already_resolved' });
    }));

  it('a rejected claim expects nothing and closes', () =>
    withRollback(async (tx) => {
      const { ex } = await lowW(tx);
      await resolveTforceException(tx, owner, ex.id, { action: 'ask_client', claimQuantity: 80, claimCents: 200_00, payQuantity: 1 });
      const [line] = await tx.select().from(settlementLines).where(eq(settlementLines.kind, 'claim_adjustment'));
      expect(line!.expectedCents).toBe(200_00);
      await respondToClaim(tx, owner, line!.id, { response: 'rejected', acceptedCents: null, payeeCents: null });
      const [after] = await tx.select().from(settlementLines).where(eq(settlementLines.id, line!.id));
      expect(after).toMatchObject({ expectedCents: 0, status: 'paid' });
    }));
});

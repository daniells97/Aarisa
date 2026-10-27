import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { rates, serviceTypes, workView } from '~/db/schema';
import { actorAs, clearHovership, driverWithCode, withRollback } from '../../tests/helpers/db';
import { importHovership, loadHovershipWeek } from './hovership';
import { tierIdsByCode } from './ops';
import { addRate } from './setup';

const owner = actorAs('owner');
// Nayibi Perez (DUB006) on Monday July 6, 2027: the client report as Hovership sends it.
const report = (date: string) => `POD Date,DriverCode,DriverNameCode,Tier 1,Tier 2,Tier 3,Tier 4,Stat,Stem,Stem Reason\n${date},DUB006,Nayibi Perez,0,43,7,0,0,20,Diablo\n`;

describe('tiers and rate agreements (stage 4 of the redesign)', () => {
  it('keeps each tier as the report has it and values it with that tier\'s rate', () => withRollback(async (tx) => {
    await clearHovership(tx);
    await importHovership(tx, owner, { fileName: 'jul.csv', text: report('2027-07-05') });
    const nayibi = await driverWithCode(tx, 'DUB006');
    const rows = await tx.select().from(workView).where(and(eq(workView.driverId, nayibi.id), eq(workView.date, '2027-07-05')));
    expect(rows.map((r) => [r.tierCode, r.pieces]).sort()).toEqual([['T2', 43], ['T3', 7]]);
    const week = await loadHovershipWeek(tx, owner, '2027-07-05');
    expect(week.totals).toMatchObject({ t13: 50, revenueCents: 150_00, driverPayCents: 125_00, stemCents: 20_00 });
  }));

  it('a client renegotiation of one tier changes only that tier\'s revenue, and leaves driver pay and its history alone', () => withRollback(async (tx) => {
    await clearHovership(tx);
    const [pkg] = await tx.select().from(serviceTypes).where(eq(serviceTypes.code, 'hovership_packages'));
    const tiers = await tierIdsByCode(tx, pkg!.id);
    await addRate(tx, owner, { serviceTypeId: pkg!.id, tierId: tiers.get('T2')!, clientRateCents: 325, driverRateCents: 250, effectiveFrom: '2027-01-15', reason: 'Annual renegotiation 2027' });
    const t2 = await tx.select().from(rates).where(eq(rates.tierId, tiers.get('T2')!));
    expect(t2.filter((r) => r.side === 'payee')).toHaveLength(1); // driver amount didn't change: no new payee rate
    expect(t2.filter((r) => r.side === 'client').map((r) => r.rateCents).sort()).toEqual([300, 325]);

    await importHovership(tx, owner, { fileName: 'jan.csv', text: report('2027-01-11') + report('2027-01-20').split('\n')[1] + '\n' });
    expect((await loadHovershipWeek(tx, owner, '2027-01-11')).totals).toMatchObject({ revenueCents: 150_00, driverPayCents: 125_00 });
    // From Jan 15 the 43 Tier 2 packages earn $3.25: 43 × 3.25 + 7 × 3.00 = $160.75; the driver still gets $125.
    expect((await loadHovershipWeek(tx, owner, '2027-01-18')).totals).toMatchObject({ revenueCents: 160_75, driverPayCents: 125_00 });
  }));
});

import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { otherRevenues, zoneAliases, zones } from '~/db/schema';
import { ForbiddenError } from './actor';
import { actorAs, clearHovership, withRollback } from '../../tests/helpers/db';
import { importHovership, loadHovershipWeek } from './hovership';
import { classifyOtherRevenue } from './revenue';

const owner = actorAs('owner');
const header = 'POD Date,DriverCode,DriverNameCode,Tier 1,Tier 2,Tier 3,Tier 4,Stat,Stem,Stem Reason\n';
const row = (date: string, stem: string, reason: string) => `${date},DUB006,Nayibi Perez,0,10,0,0,0,${stem},${reason}\n`;

describe('STEM zones and review (stage 5a of the redesign)', () => {
  it('recognises a zone however it is written and keeps the driver-day it came with', () => withRollback(async (tx) => {
    await clearHovership(tx);
    await importHovership(tx, owner, { fileName: 'a.csv', text: header + row('2027-02-01', '20', 'DIablo') + row('2027-02-02', '40', 'disco bay') });
    const rows = await tx.select({ zone: zones.name, status: otherRevenues.status, execution: otherRevenues.executionId }).from(otherRevenues)
      .innerJoin(zones, eq(zones.id, otherRevenues.zoneId)).where(eq(otherRevenues.date, '2027-02-01'));
    expect(rows).toMatchObject([{ zone: 'Diablo', status: 'classified' }]);
    expect(rows[0]!.execution).toBeTruthy();
    expect((await loadHovershipWeek(tx, owner, '2027-02-01')).stemToReview).toEqual([]);
  }));

  it('an unknown zone waits for review; naming it once teaches the alias for next time', () => withRollback(async (tx) => {
    await clearHovership(tx);
    const out = await importHovership(tx, owner, { fileName: 'b.csv', text: header + row('2027-02-01', '30', 'Pleasanton') });
    expect(out).toMatchObject({ status: 'partial', stemToReview: 1 });
    const [review] = (await loadHovershipWeek(tx, owner, '2027-02-01')).stemToReview;
    expect(review).toMatchObject({ reason: 'Pleasanton', amountCents: 30_00 });
    await expect(classifyOtherRevenue(tx, actorAs('dispatcher'), review!.id, { newZone: 'Pleasanton' })).rejects.toBeInstanceOf(ForbiddenError);
    await classifyOtherRevenue(tx, owner, review!.id, { newZone: 'Pleasanton' });
    expect(await tx.select().from(zoneAliases).where(eq(zoneAliases.aliasText, 'pleasanton'))).toHaveLength(0); // the zone name itself matches
    await importHovership(tx, owner, { fileName: 'c.csv', text: header + row('2027-02-02', '30', 'PLEASANTON ') });
    const [next] = await tx.select().from(otherRevenues).where(and(eq(otherRevenues.date, '2027-02-02'), eq(otherRevenues.reason, 'PLEASANTON')));
    expect(next).toMatchObject({ status: 'classified' });
  }));

  it('a lump amount with no reason is marked as such with a note, never left unexplained', () => withRollback(async (tx) => {
    await clearHovership(tx);
    await importHovership(tx, owner, { fileName: 'd.csv', text: header + row('2027-02-03', '1075', '') });
    const [review] = (await loadHovershipWeek(tx, owner, '2027-02-01')).stemToReview;
    expect(review).toMatchObject({ reason: null, unusual: true });
    await expect(classifyOtherRevenue(tx, owner, review!.id, { lumpAdjustment: '  ' })).rejects.toMatchObject({ code: 'note_required' });
    const after = await classifyOtherRevenue(tx, owner, review!.id, { lumpAdjustment: 'Hovership catch-up payment' });
    expect(after).toMatchObject({ status: 'lump_adjustment', zoneId: null, reviewNote: 'Hovership catch-up payment' });
  }));
});

describe('import status after review', () => {
  it('the import is done once its last STEM is classified', () => withRollback(async (tx) => {
    await clearHovership(tx);
    const out = await importHovership(tx, owner, { fileName: 'e.csv', text: header + row('2027-02-01', '30', 'Pleasanton') });
    const [review] = (await loadHovershipWeek(tx, owner, '2027-02-01')).stemToReview;
    await classifyOtherRevenue(tx, owner, review!.id, { newZone: 'Pleasanton' });
    expect((await loadHovershipWeek(tx, owner, '2027-02-01')).importState).toMatchObject({ id: out.status !== 'failed' ? out.importId : '', status: 'done' });
  }));
});

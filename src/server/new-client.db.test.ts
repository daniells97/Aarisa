import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { routes, serviceTypes, settlementLines } from '~/db/schema';
import { ForbiddenError } from './actor';
import { actorAs, driverNamed, withRollback } from '../../tests/helpers/db';
import { createClientWithContract, saveLayout } from './clients';
import { setAssignment } from './daily';
import { importReport } from './imports';
import { getOperation } from './ops';
import { loadRun } from './payroll';
import { addRate } from './setup';
import { loadTforceWeek, recheckForDate } from './tforce';
import { loadHovershipWeek } from './hovership';

const owner = actorAs('owner');

// Stage 6c: a client the code has never heard of, set up only with data.
describe('a new client, end to end, without code', () => {
  it('daily-list client: report by route, driver from the daily list, payroll and expected payment', () => withRollback(async (tx) => {
    await expect(createClientWithContract(tx, actorAs('finance'), {
      clientName: 'Bay Parcel', contractName: 'Bay Parcel Ecom', driverSource: 'daily_list', payCycle: 'weekly', cycleAnchor: '2027-02-01', paymentTermsDays: 15, weeklySettlementKind: 'weekly_statement',
    })).rejects.toBeInstanceOf(ForbiddenError);
    const { operationId, operation } = await createClientWithContract(tx, owner, {
      clientName: 'Bay Parcel', contractName: 'Bay Parcel Ecom', driverSource: 'daily_list', payCycle: 'weekly', cycleAnchor: '2027-02-01', paymentTermsDays: 15, weeklySettlementKind: 'weekly_statement',
    });
    expect(operation).toBe('bay_parcel_ecom');

    await expect(saveLayout(tx, owner, operationId, [{ sourceName: 'Delivery Date', meaning: 'work_date', required: true }]))
      .rejects.toMatchObject({ code: 'layout_needs_route' });
    await saveLayout(tx, owner, operationId, [
      { sourceName: 'Delivery Date', meaning: 'work_date', required: true },
      { sourceName: 'Route ID', meaning: 'route_code', required: true },
      { sourceName: 'Packages', meaning: 'quantity', required: true, newService: { name: 'Package', unit: 'package' } },
      { sourceName: 'Comments', meaning: 'ignore', required: false },
    ]);
    const [pkg] = await tx.select().from(serviceTypes).where(and(eq(serviceTypes.operationId, operationId), eq(serviceTypes.code, 'package')));
    await addRate(tx, owner, { serviceTypeId: pkg!.id, tierId: null, clientRateCents: 210, driverRateCents: 160, effectiveFrom: '2027-01-01' });

    const csv = 'Delivery Date,Route ID,Packages,Comments\n2027-02-01,BP-01,132,\n2027-02-01,BP-02,98,late truck\n';
    const out = await importReport(tx, owner, { operation, fileName: 'bp.csv', text: csv });
    expect(out).toMatchObject({ status: 'done', rows: 2, pieces: 230, newRoutes: ['BP-01', 'BP-02'], openExceptions: 2 }); // nobody on the list yet

    const nayibi = await driverNamed(tx, 'Nayibi Perez');
    const robert = await driverNamed(tx, 'Robert Arteaga');
    const routeId = async (code: string) => (await tx.select().from(routes).where(and(eq(routes.operationId, operationId), eq(routes.code, code))))[0]!.id;
    await setAssignment(tx, owner, { date: '2027-02-01', routeId: await routeId('BP-01'), payee: { driverId: nayibi.id } });
    await setAssignment(tx, owner, { date: '2027-02-01', routeId: await routeId('BP-02'), payee: { driverId: robert.id } });
    await recheckForDate(tx, owner, '2027-02-01', operation); // what the daily-list server function does after a change
    const week = await loadTforceWeek(tx, owner, '2027-02-01', operation);
    expect(week.summary).toMatchObject({ pieces: 230, routeDays: 2, matched: 2 });

    const run = await loadRun(tx, owner, `${operation}-2027-02-01`);
    expect(run.totals).toMatchObject({ drivers: 2, routeDays: 2, packages: 230, payCents: 230 * 160, revenueCents: 230 * 210 });
    expect(run.status).toBe('ready');
    const op = await getOperation(tx, operation);
    const [line] = await tx.select().from(settlementLines).where(eq(settlementLines.operationId, op.id));
    expect(line).toMatchObject({ kind: 'weekly_statement', expectedCents: 230 * 210, expectedDate: '2027-02-22' });
  }));

  it('report-code client: the report names the driver; an unknown code waits; a tier and other revenue are read', () => withRollback(async (tx) => {
    const { operationId, operation } = await createClientWithContract(tx, owner, {
      clientName: 'Coast Courier', contractName: 'Coast Courier', driverSource: 'report_code', payCycle: 'biweekly', cycleAnchor: '2027-02-01', paymentTermsDays: 21, weeklySettlementKind: 'invoice',
    });
    await saveLayout(tx, owner, operationId, [
      { sourceName: 'Date', meaning: 'work_date', required: true },
      { sourceName: 'Courier ID', meaning: 'driver_code', required: true },
      { sourceName: 'Zone A', meaning: 'quantity', required: true, newService: { name: 'Stop', unit: 'stop' }, tierCode: 'A' },
      { sourceName: 'Zone B', meaning: 'quantity', required: true, newService: { name: 'Stop', unit: 'stop' }, tierCode: 'B' },
      { sourceName: 'Fuel', meaning: 'other_revenue', required: false, revenueName: 'Fuel surcharge' },
    ]);
    const out = await importReport(tx, owner, { operation, fileName: 'cc.csv', text: 'Date,Courier ID,Zone A,Zone B,Fuel\n2027-02-02,CC-9,10,5,12.50\n' });
    expect(out).toMatchObject({ status: 'partial', unknownCodes: [{ code: 'CC-9', days: 1 }] });
    const week = await loadHovershipWeek(tx, owner, '2027-02-01', operation);
    expect(week.unknownCodes).toHaveLength(1);
    expect(week.shows).toMatchObject({ tier4: false, tiers: true });
  }));
});

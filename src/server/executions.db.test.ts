import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { routeExecutions, routes, workRecords, workView } from '~/db/schema';
import { TFORCE_CSV, actorAs, clearTforceReports, driverNamed, withRollback } from '../../tests/helpers/db';
import { setAssignment } from './daily';
import { payeeIdOf } from './executions';
import { getOperation } from './ops';
import { ownCompanyId } from './people';
import { importTforce } from './tforce';

const owner = actorAs('owner');

describe('route executions (stage 3 of the redesign)', () => {
  it('refuses a confirmed day without a payee', () => withRollback(async (tx) => {
    const op = await getOperation(tx, 'tforce');
    await expect(tx.insert(routeExecutions).values({ operationId: op.id, date: '2027-01-04', status: 'confirmed' })).rejects.toThrow();
  }));

  it('never makes Aarisa itself a payee', () => withRollback(async (tx) => {
    await expect(payeeIdOf(tx, { driverId: null, contractorId: await ownCompanyId(tx) })).rejects.toMatchObject({ code: 'own_company_not_payee' });
  }));

  it('a report day the list never named has no driver; assigning one moves its pieces without touching the work rows', () => withRollback(async (tx) => {
    const op = await getOperation(tx, 'tforce');
    await clearTforceReports(tx);
    const [z] = await tx.select().from(routes).where(and(eq(routes.operationId, op.id), eq(routes.code, '9000Z')));
    const csv = TFORCE_CSV.split('\n').filter((l, i) => i === 0 || l.includes('9000Z')).join('\n').replaceAll('2026-06', '2027-03');
    await importTforce(tx, owner, { fileName: 'z.csv', text: csv });
    const [day] = await tx.select().from(routeExecutions).where(and(eq(routeExecutions.routeId, z!.id), eq(routeExecutions.date, '2027-03-17')));
    expect(day).toMatchObject({ status: 'no_driver', payeeId: null, source: 'client_report' });
    const [before] = await tx.select().from(workRecords).where(eq(workRecords.executionId, day!.id));

    const marcus = await driverNamed(tx, 'Marcus Dub');
    await setAssignment(tx, owner, { date: '2027-03-17', routeId: z!.id, payee: { driverId: marcus.id } });
    const [row] = await tx.select().from(workView).where(eq(workView.id, before!.id));
    expect(row).toMatchObject({ driverId: marcus.id, pieces: before!.pieces });
    const [after] = await tx.select().from(workRecords).where(eq(workRecords.id, before!.id));
    expect(after!.updatedAt).toEqual(before!.updatedAt);
  }));
});

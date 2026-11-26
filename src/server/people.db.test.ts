import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { contractors, payees, routeOwnerships } from '~/db/schema';
import { actorAs, contractorNamed, withRollback } from '../../tests/helpers/db';
import {
  contractorProfiles, createDriver, createRoute, driverProfile, ownCompanyId, routeOwners, updateDriverProfile,
} from './people';
import { getOperation } from './ops';
import { addDriverFromToday } from './daily';

const owner = actorAs('owner');
const base = { hovershipCode: null, contractorId: null, phone: null, aliases: [], active: true, setupComplete: true };

describe('payees, companies and route owners (stage 2 of the redesign)', () => {
  it('keeps Aarisa as the one own company, left out of the contractor list', () => withRollback(async (tx) => {
    const own = await ownCompanyId(tx);
    expect((await contractorProfiles(tx)).some((c) => c.id === own)).toBe(false);
    expect((await contractorProfiles(tx, { includeOwn: true })).find((c) => c.id === own)).toMatchObject({ isOwnCompany: true });
    const [p] = await tx.insert(payees).values({ payeeType: 'contractor', displayName: 'Second own' }).returning();
    await expect(tx.insert(contractors).values({ payeeId: p!.id, isOwnCompany: true })).rejects.toThrow();
  }));

  it('moves a driver to Puma from a date and keeps the old company for earlier weeks', () => withRollback(async (tx) => {
    const puma = await contractorNamed(tx, 'Puma');
    const d = await createDriver(tx, owner, { ...base, fullName: 'Test Mover' }, '2026-09-01');
    expect(d.contractorId).toBeNull();
    await updateDriverProfile(tx, owner, d.id, { ...base, fullName: 'Test Mover', contractorId: puma.id }, '2026-10-01');
    expect((await driverProfile(tx, d.id, '2026-09-15'))!.contractorId).toBeNull();
    expect((await driverProfile(tx, d.id, '2026-10-01'))!.contractorId).toBe(puma.id);
  }));

  it('refuses a second active driver with the same name, a taken code or a taken alias', () => withRollback(async (tx) => {
    await createDriver(tx, owner, { ...base, fullName: 'Test Twin', hovershipCode: 'TST001', aliases: ['Twinny'] }, '2026-10-01');
    await expect(createDriver(tx, owner, { ...base, fullName: 'test  twin' }, '2026-10-01')).rejects.toMatchObject({ code: 'driver_exists' });
    await expect(createDriver(tx, owner, { ...base, fullName: 'Other', hovershipCode: 'tst001' }, '2026-10-01')).rejects.toMatchObject({ code: 'code_taken' });
    await expect(createDriver(tx, owner, { ...base, fullName: 'Other', aliases: ['TWINNY '] }, '2026-10-01')).rejects.toMatchObject({ code: 'alias_taken' });
  }));

  it('keeps email, home address, license and emergency contact; an edit without them leaves them as they were', () => withRollback(async (tx) => {
    const d = await createDriver(tx, owner, {
      ...base, fullName: 'Test Contact', email: ' Pedro@Example.com ', address: '1 Main St,  Oakland', licenseNumber: 'd123',
      emergencyName: 'Ana', emergencyPhone: '+14155550100',
    }, '2026-11-26');
    expect(d).toMatchObject({ email: 'pedro@example.com', address: '1 Main St, Oakland', licenseNumber: 'D123', emergencyName: 'Ana', emergencyPhone: '+14155550100' });
    const after = await updateDriverProfile(tx, owner, d.id, { ...base, fullName: 'Test Contact' }, '2026-11-26');
    expect(after).toMatchObject({ email: 'pedro@example.com', licenseNumber: 'D123', emergencyName: 'Ana' });
    const cleared = await updateDriverProfile(tx, owner, d.id, { ...base, fullName: 'Test Contact', email: '', licenseNumber: null }, '2026-11-26');
    expect(cleared).toMatchObject({ email: null, licenseNumber: null, emergencyName: 'Ana' });
    await expect(createDriver(tx, owner, { ...base, fullName: 'Bad Mail', email: 'not-an-email' }, '2026-11-26')).rejects.toMatchObject({ code: 'email_invalid' });
  }));

  it('lets an operator create a person from Daily operations, fully set up; read-only users cannot', () => withRollback(async (tx) => {
    const d = await addDriverFromToday(tx, actorAs('dispatcher'), { ...base, fullName: 'Test From Today', worksTforce: true, worksHovership: false, licenseNumber: 'X1' });
    expect(d).toMatchObject({ setupComplete: true, worksTforce: true, licenseNumber: 'X1' });
    await expect(addDriverFromToday(tx, actorAs('viewer'), { ...base, fullName: 'Nope' })).rejects.toThrow();
  }));

  it('answers who owns a route on a date from its ownership history', () => withRollback(async (tx) => {
    const op = await getOperation(tx, 'tforce');
    const puma = await contractorNamed(tx, 'Puma');
    const r = await createRoute(tx, owner, { operationId: op.id, code: 'TST1', contractorId: puma.id, usualDriverId: null });
    await tx.insert(routeOwnerships).values({ routeId: r.id, contractorId: await ownCompanyId(tx), effectiveFrom: '2027-03-01' });
    expect((await routeOwners(tx, '2026-12-31', [r.id])).get(r.id)).toBe(puma.id);
    expect((await routeOwners(tx, '2027-03-01', [r.id])).get(r.id)).toBeNull();
    const rows = await tx.select().from(routeOwnerships).where(eq(routeOwnerships.routeId, r.id));
    expect(rows).toHaveLength(2);
  }));
});

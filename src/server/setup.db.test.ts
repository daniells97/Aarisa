import { describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { auditLog, serviceTypes } from '~/db/schema';
import { ALL_ROLES, actorAs, withRollback } from '../../tests/helpers/db';
import { ForbiddenError } from './actor';
import { addContractor, addDriver, addRate, loadSetup, updateDriver } from './setup';

const TODAY = '2026-06-20';
const driver = { fullName: 'Test Driver', hovershipCode: 'tst999', contractorId: null, phone: null, aliases: ['TD'], active: true };

describe('setup data (server)', () => {
  it('shows Hovership rates to money roles and hides client rates from dispatchers', () =>
    withRollback(async (tx) => {
      const owner = await loadSetup(tx, actorAs('owner'), TODAY);
      const t13 = owner.rates.find((r) => r.serviceCode === 'hovership_packages' && r.tier === 't1_3' && r.current)!;
      expect([t13.clientRateCents, t13.driverRateCents]).toEqual([300, 250]);
      const dispatcher = await loadSetup(tx, actorAs('dispatcher'), TODAY);
      expect(dispatcher.showMoney).toBe(false);
      expect(dispatcher.rates.every((r) => r.clientRateCents === null)).toBe(true);
      expect(dispatcher.rates.find((r) => r.id === t13.id)!.driverRateCents).toBe(250);
    }));

  for (const role of ALL_ROLES) {
    it(`${role} ${role === 'owner' ? 'can' : 'cannot'} edit drivers, contractors and rates`, () =>
      withRollback(async (tx) => {
        const actor = actorAs(role);
        const [stat] = await tx.select().from(serviceTypes).where(eq(serviceTypes.code, 'stat'));
        const attempts = [
          () => addDriver(tx, actor, driver),
          () => addContractor(tx, actor, 'Test contractor'),
          () => addRate(tx, actor, { serviceTypeId: stat!.id, tier: null, clientRateCents: 1100, driverRateCents: 550, effectiveFrom: '2026-09-01' }),
        ];
        for (const attempt of attempts) {
          if (role === 'owner') await expect(attempt()).resolves.toBeTruthy();
          else await expect(attempt()).rejects.toBeInstanceOf(ForbiddenError);
        }
      }));
  }

  it('adds a new rate instead of editing and audits it', () =>
    withRollback(async (tx) => {
      const owner = actorAs('owner');
      const [stat] = await tx.select().from(serviceTypes).where(eq(serviceTypes.code, 'stat'));
      const row = await addRate(tx, owner, { serviceTypeId: stat!.id, tier: null, clientRateCents: 1100, driverRateCents: 550, effectiveFrom: '2026-09-01' });
      const before = await loadSetup(tx, owner, '2026-08-31');
      const after = await loadSetup(tx, owner, '2026-09-01');
      expect(before.rates.find((r) => r.serviceCode === 'stat' && r.current)!.driverRateCents).toBe(500);
      expect(after.rates.find((r) => r.serviceCode === 'stat' && r.current)!.driverRateCents).toBe(550);
      await expect(addRate(tx, owner, { serviceTypeId: stat!.id, tier: null, clientRateCents: 1, driverRateCents: 1, effectiveFrom: '2026-09-01' }))
        .rejects.toMatchObject({ code: 'rate_exists_on_date' });
      const trail = await tx.select().from(auditLog).where(and(eq(auditLog.tableName, 'rates'), eq(auditLog.recordId, row.id)));
      expect(trail).toHaveLength(1);
    }));

  it('keeps Hovership codes unique and records before and after on edits', () =>
    withRollback(async (tx) => {
      const owner = actorAs('owner');
      const d = await addDriver(tx, owner, driver);
      expect(d.hovershipCode).toBe('TST999');
      await expect(addDriver(tx, owner, { ...driver, fullName: 'Other' })).rejects.toMatchObject({ code: 'code_taken' });
      await updateDriver(tx, owner, d.id, { ...driver, fullName: 'Renamed', active: false });
      const [trail] = await tx.select().from(auditLog).where(and(eq(auditLog.recordId, d.id), eq(auditLog.action, 'update')));
      expect((trail!.before as { fullName: string }).fullName).toBe('Test Driver');
      expect((trail!.after as { fullName: string; active: boolean })).toMatchObject({ fullName: 'Renamed', active: false });
    }));
});

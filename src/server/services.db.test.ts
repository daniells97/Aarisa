import { describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { auditLog, serviceTypes } from '~/db/schema';
import { ALL_ROLES, actorAs, withRollback } from '../../tests/helpers/db';
import { ForbiddenError } from './actor';
import { extraJobOptions } from './extra-jobs';
import { addRate, addService, serviceCode, updateService } from './setup';

const input = { name: 'Hazmat pickup', nameEs: 'Recogida de materiales peligrosos', requiresOrderNumber: true, requiresNote: false };

describe('services (server)', () => {
  it('makes a code from the English name', () => {
    expect(serviceCode('Hazmat pickup')).toBe('hazmat_pickup');
    expect(serviceCode('  Recolección  día-siguiente ')).toBe('recoleccion_dia_siguiente');
  });

  for (const role of ALL_ROLES.filter((r) => r !== 'owner')) {
    it(`${role} cannot add or edit services`, () =>
      withRollback(async (tx) => {
        await expect(addService(tx, actorAs(role), { ...input, operation: 'tforce' })).rejects.toBeInstanceOf(ForbiddenError);
        const [s] = await tx.select().from(serviceTypes).where(eq(serviceTypes.code, 'grainger'));
        await expect(updateService(tx, actorAs(role), s!.id, { ...input, active: false })).rejects.toBeInstanceOf(ForbiddenError);
      }));
  }

  it('a new service shows in the extra job form with its default amounts, and leaves it when turned off', () =>
    withRollback(async (tx) => {
      const owner = actorAs('owner');
      const s = await addService(tx, owner, { ...input, operation: 'tforce' });
      expect(s).toMatchObject({ code: 'hazmat_pickup', unit: 'job', fromReport: false, active: true });
      await expect(addService(tx, owner, { ...input, operation: 'tforce' })).rejects.toMatchObject({ code: 'name_taken' });
      await addRate(tx, owner, { serviceTypeId: s.id, tier: null, clientRateCents: 150_00, driverRateCents: 90_00, effectiveFrom: '2026-01-01' });

      let opts = await extraJobOptions(tx, owner, '2026-10-09');
      expect(opts.services.map((x) => x.code)).toEqual(['recovery_route', 'pickup', 'grainger', 'hazmat_pickup', 'other']);
      expect(opts.services.find((x) => x.code === 'hazmat_pickup')).toMatchObject({ defaultClientCents: 150_00, defaultDriverCents: 90_00, requiresOrderNumber: true });
      // dispatchers get the driver default but never the client amount
      expect((await extraJobOptions(tx, actorAs('dispatcher'), '2026-10-09')).services.find((x) => x.code === 'hazmat_pickup')).toMatchObject({ defaultClientCents: null, defaultDriverCents: 90_00 });

      await updateService(tx, owner, s.id, { ...input, name: 'Hazmat', active: false });
      opts = await extraJobOptions(tx, owner, '2026-10-09');
      expect(opts.services.map((x) => x.code)).not.toContain('hazmat_pickup');
      const trail = await tx.select().from(auditLog).where(and(eq(auditLog.tableName, 'service_types'), eq(auditLog.recordId, s.id)));
      expect(trail.map((a) => a.action).sort()).toEqual(['insert', 'update']);
    }));

  it('report services can be renamed but not turned off or changed', () =>
    withRollback(async (tx) => {
      const [stat] = await tx.select().from(serviceTypes).where(eq(serviceTypes.code, 'stat'));
      await expect(updateService(tx, actorAs('owner'), stat!.id, { name: 'Stat', nameEs: null, requiresOrderNumber: false, requiresNote: false, active: false }))
        .rejects.toMatchObject({ code: 'service_from_report' });
      const after = await updateService(tx, actorAs('owner'), stat!.id, { name: 'Stat stop (urgent)', nameEs: 'Parada urgente', requiresOrderNumber: true, requiresNote: true, active: true });
      expect(after).toMatchObject({ name: 'Stat stop (urgent)', nameEs: 'Parada urgente', requiresOrderNumber: false, requiresNote: false, code: 'stat', unit: 'stop' });
    }));
});

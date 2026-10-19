import { describe, expect, it } from 'vitest';
import { driverProfile } from './people';
import { and, eq } from 'drizzle-orm';
import { auditLog, routes } from '~/db/schema';
import { actorAs, withRollback, driverNamed, contractorNamed } from '../../tests/helpers/db';
import { ForbiddenError } from './actor';
import { addRoute, assignNewDriver, loadDay } from './daily';

const DATE = '2026-09-03';

describe("adding routes and drivers from Today's drivers (server)", () => {
  it('adds a route with an existing driver as its usual driver, confirmed for the day', () =>
    withRollback(async (tx) => {
      const d = actorAs('dispatcher');
      const norwin = await driverNamed(tx, 'Norwin Saloman');
      const r = await addRoute(tx, d, { date: DATE, code: ' 9000t ', payee: { driverId: norwin!.id } });
      expect(r).toMatchObject({ code: '9000T', usualDriverId: norwin!.id, contractorId: null });
      const row = (await loadDay(tx, d, DATE)).rows.find((x) => x.code === '9000T')!;
      expect(row).toMatchObject({ status: 'confirmed', today: { name: 'Norwin Saloman' }, usual: { name: 'Norwin Saloman' } });
      await expect(addRoute(tx, d, { date: DATE, code: '9000T', payee: { driverId: norwin!.id } })).rejects.toMatchObject({ code: 'route_exists' });
      await expect(addRoute(tx, d, { date: DATE, code: '9000#', payee: { driverId: norwin!.id } })).rejects.toMatchObject({ code: 'route_code_invalid' });
      const trail = await tx.select().from(auditLog).where(and(eq(auditLog.tableName, 'routes'), eq(auditLog.recordId, r.id)));
      expect(trail).toHaveLength(1);
    }));

  it('a contractor makes it a contractor route; a new name creates the driver first', () =>
    withRollback(async (tx) => {
      const o = actorAs('owner');
      const puma = await contractorNamed(tx, 'Puma');
      expect(await addRoute(tx, o, { date: DATE, code: '9000U', payee: { contractorId: puma!.id } })).toMatchObject({ contractorId: puma!.id, usualDriverId: null });
      const r = await addRoute(tx, o, { date: DATE, code: '9000X', payee: { newDriverName: 'Carla  Mendez' } });
      const carla = await driverProfile(tx, r.usualDriverId!, '2026-06-30');
      expect(carla).toMatchObject({ fullName: 'Carla Mendez', setupComplete: false });
      await expect(addRoute(tx, o, { date: DATE, code: '9000Q', payee: { newDriverName: 'carla mendez' } })).rejects.toMatchObject({ code: 'driver_exists' });
    }));

  it('a typed new name on an existing route creates the driver and assigns them (changed)', () =>
    withRollback(async (tx) => {
      const d = actorAs('dispatcher');
      const [a] = await tx.select().from(routes).where(eq(routes.code, '9000A'));
      const res = await assignNewDriver(tx, d, { date: DATE, routeId: a!.id, fullName: 'Pedro Ruiz' });
      expect(res.driver).toMatchObject({ fullName: 'Pedro Ruiz', setupComplete: false });
      const row = (await loadDay(tx, d, DATE)).rows.find((x) => x.code === '9000A')!;
      expect(row).toMatchObject({ status: 'changed', today: { name: 'Pedro Ruiz' } });
      await expect(assignNewDriver(tx, d, { date: DATE, routeId: a!.id, fullName: 'Norwin Saloman' })).rejects.toMatchObject({ code: 'driver_exists' });
    }));

  it('finance and viewers cannot add routes or drivers here', () =>
    withRollback(async (tx) => {
      const [a] = await tx.select().from(routes).where(eq(routes.code, '9000A'));
      for (const role of ['finance', 'viewer'] as const) {
        await expect(addRoute(tx, actorAs(role), { date: DATE, code: '9000P', payee: { newDriverName: 'X Y' } })).rejects.toBeInstanceOf(ForbiddenError);
        await expect(assignNewDriver(tx, actorAs(role), { date: DATE, routeId: a!.id, fullName: 'X Y' })).rejects.toBeInstanceOf(ForbiddenError);
      }
    }));
});

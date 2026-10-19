import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import type { Tx } from '~/db/client';
import { operations, routes } from '~/db/schema';
import type { Actor } from './actor';
import { read, run } from './fn';
import { addDriverForRoute, addRoute, assignNewDriver, confirmUsual, loadDay, setAssignment, undoAssignment } from './daily';
import { recheckForDate } from './tforce';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const uuid = z.string().uuid();
const payee = z.union([z.object({ driverId: uuid }), z.object({ contractorId: uuid }), z.null()]);
// Any contract whose drivers come from the daily list; omitted = the first one (T-Force).
const operation = z.string().regex(/^[a-z0-9_]{1,40}$/).optional();

/** The weekly check to re-run after a change to a route's day is that route's contract. */
async function recheckRoute(tx: Tx, actor: Actor, date: string, routeId: string) {
  const [r] = await tx.select({ code: operations.code }).from(routes).innerJoin(operations, eq(operations.id, routes.operationId)).where(eq(routes.id, routeId));
  await recheckForDate(tx, actor, date, r?.code);
}

export const getDay = createServerFn({ method: 'GET' })
  .validator(z.object({ date: isoDate, operation }))
  .handler(({ data }) => read('payroll.view', (tx, actor) => loadDay(tx, actor, data.date, data.operation)));

export const assign = createServerFn({ method: 'POST' })
  .validator(z.object({ date: isoDate, routeId: uuid, payee }))
  .handler(({ data }) => run('drivers.confirm_today', async (tx, actor) => {
    const res = await setAssignment(tx, actor, data);
    await recheckRoute(tx, actor, data.date, data.routeId); // keeps the weekly check in step with the list
    return res;
  }));

export const undoAssign = createServerFn({ method: 'POST' })
  .validator(z.object({
    date: isoDate, routeId: uuid,
    previous: z.object({ driverId: uuid.nullable(), contractorId: uuid.nullable(), rawName: z.string().nullable(), status: z.enum(['proposed', 'confirmed', 'changed', 'waiting', 'no_driver']) }).nullable(),
  }))
  .handler(({ data }) => run('drivers.confirm_today', async (tx, actor) => { await undoAssignment(tx, actor, data); await recheckRoute(tx, actor, data.date, data.routeId); return true; }));

export const confirmAll = createServerFn({ method: 'POST' })
  .validator(z.object({ date: isoDate, operation }))
  .handler(({ data }) => run('drivers.confirm_today', async (tx, actor) => { const n = await confirmUsual(tx, actor, data.date, data.operation); await recheckForDate(tx, actor, data.date, data.operation); return n; }));

export const addForRoute = createServerFn({ method: 'POST' })
  .validator(z.object({ date: isoDate, routeId: uuid, fullName: z.string().max(120), contractorId: uuid.nullable() }))
  .handler(({ data }) => run('drivers.confirm_today', async (tx, actor) => { const d = await addDriverForRoute(tx, actor, data); await recheckRoute(tx, actor, data.date, data.routeId); return d.id; }));

export const createRoute = createServerFn({ method: 'POST' })
  .validator(z.object({
    date: isoDate,
    code: z.string().max(20),
    payee: z.union([z.object({ driverId: uuid }), z.object({ contractorId: uuid }), z.object({ newDriverName: z.string().min(1).max(120) })]),
    operation,
  }))
  .handler(({ data }) => run('drivers.confirm_today', async (tx, actor) => {
    const r = await addRoute(tx, actor, data);
    await recheckRoute(tx, actor, data.date, r.id);
    return { routeId: r.id, code: r.code };
  }));

export const assignNew = createServerFn({ method: 'POST' })
  .validator(z.object({ date: isoDate, routeId: uuid, fullName: z.string().min(1).max(120) }))
  .handler(({ data }) => run('drivers.confirm_today', async (tx, actor) => {
    const res = await assignNewDriver(tx, actor, data);
    await recheckRoute(tx, actor, data.date, data.routeId);
    return { driverId: res.driver.id, name: res.driver.fullName, previous: res.previous };
  }));

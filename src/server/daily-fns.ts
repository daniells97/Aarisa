import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { read, run } from './fn';
import { addDriverForRoute, confirmUsual, loadDay, setAssignment, undoAssignment } from './daily';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const uuid = z.string().uuid();
const payee = z.union([z.object({ driverId: uuid }), z.object({ contractorId: uuid }), z.null()]);

export const getDay = createServerFn({ method: 'GET' })
  .validator(z.object({ date: isoDate }))
  .handler(({ data }) => read('payroll.view', (tx, actor) => loadDay(tx, actor, data.date)));

export const assign = createServerFn({ method: 'POST' })
  .validator(z.object({ date: isoDate, routeId: uuid, payee }))
  .handler(({ data }) => run('drivers.confirm_today', (tx, actor) => setAssignment(tx, actor, data)));

export const undoAssign = createServerFn({ method: 'POST' })
  .validator(z.object({
    date: isoDate, routeId: uuid,
    previous: z.object({ driverId: uuid.nullable(), contractorId: uuid.nullable(), rawName: z.string().nullable(), status: z.enum(['proposed', 'confirmed', 'changed', 'waiting', 'no_driver']) }).nullable(),
  }))
  .handler(({ data }) => run('drivers.confirm_today', async (tx, actor) => { await undoAssignment(tx, actor, data); return true; }));

export const confirmAll = createServerFn({ method: 'POST' })
  .validator(z.object({ date: isoDate }))
  .handler(({ data }) => run('drivers.confirm_today', (tx, actor) => confirmUsual(tx, actor, data.date)));

export const addForRoute = createServerFn({ method: 'POST' })
  .validator(z.object({ date: isoDate, routeId: uuid, fullName: z.string().max(120), contractorId: uuid.nullable() }))
  .handler(({ data }) => run('drivers.confirm_today', async (tx, actor) => (await addDriverForRoute(tx, actor, data)).id));

import { can } from '~/domain/permissions';
import { ledgerByDriver } from './driver-ledger';
import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { driverInput } from './driver-input';
import { eq } from 'drizzle-orm';
import type { Tx } from '~/db/client';
import { operations, routeExecutions, routes } from '~/db/schema';
import type { Actor } from './actor';
import { read, run } from './fn';
import { removeRouteRow, setPersonStatus, setRouteStatus, addPersonToday, moveToCode, removePersonToday, sendDayList, setPersonSortCodes, setPersonToday, addDriverFromToday, addDriverForRoute, addRoute, assignNewDriver, confirmUsual, markOffToday, setRouteOnList, unconfirmUsual, loadDay, setAssignment, setSortCodes, undoAssignment } from './daily';
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
  .handler(({ data }) => read('payroll.view', async (tx, actor) => ({
    ...(await loadDay(tx, actor, data.date, data.operation)),
    // Per person: open notes and what they still owe, for the actions on each row.
    ledger: Object.fromEntries(await ledgerByDriver(tx)),
    canLogExtra: can(actor.role, 'extra_jobs.log'),
  })));

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
    previous: z.object({ driverId: uuid.nullable(), contractorId: uuid.nullable(), rawName: z.string().nullable(), status: z.enum(['proposed', 'confirmed', 'changed', 'waiting', 'no_driver', 'off']) }).nullable(),
  }))
  .handler(({ data }) => run('drivers.confirm_today', async (tx, actor) => { await undoAssignment(tx, actor, data); await recheckRoute(tx, actor, data.date, data.routeId); return true; }));

/** "Didn't run today" on a driver code (one tap, with Undo on the page). */
export const markOff = createServerFn({ method: 'POST' })
  .validator(z.object({ date: isoDate, routeId: uuid }))
  .handler(({ data }) => run('drivers.confirm_today', async (tx, actor) => {
    const res = await markOffToday(tx, actor, data);
    await recheckRoute(tx, actor, data.date, data.routeId);
    return res;
  }));

export const confirmAll = createServerFn({ method: 'POST' })
  .validator(z.object({ date: isoDate, operation }))
  .handler(({ data }) => run('drivers.confirm_today', async (tx, actor) => { const n = await confirmUsual(tx, actor, data.date, data.operation); await recheckForDate(tx, actor, data.date, data.operation); return n; }));

export const unconfirmAll = createServerFn({ method: 'POST' })
  .validator(z.object({ date: isoDate, operation }))
  .handler(({ data }) => run('drivers.confirm_today', async (tx, actor) => { const n = await unconfirmUsual(tx, actor, data.date, data.operation); await recheckForDate(tx, actor, data.date, data.operation); return n; }));

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

export const saveSortCodes = createServerFn({ method: 'POST' })
  .validator(z.object({ date: isoDate, routeId: uuid, sortCodeIds: z.array(uuid).max(20) }))
  .handler(({ data }) => run('drivers.confirm_today', (tx, actor) => setSortCodes(tx, actor, data)));

/** Takes a driver code off Today's drivers, or puts it back (Undo). */
export const setRouteListed = createServerFn({ method: 'POST' })
  .validator(z.object({ routeId: uuid, active: z.boolean() }))
  .handler(({ data }) => run('drivers.confirm_today', async (tx, actor) => (await setRouteOnList(tx, actor, data)).code));

/** "+ New person…" in Daily operations: the same driver form as Drivers and rates. Returns who was created. */
export const createDriverToday = createServerFn({ method: 'POST' })
  .validator(driverInput)
  .handler(({ data }) => run('drivers.confirm_today', async (tx, actor) => {
    const d = await addDriverFromToday(tx, actor, data);
    return { id: d.id, name: d.fullName };
  }));

// ---------- person first: people without a driver code, giving a code, sending the confirmed list ----------

const dayOf = async (tx: Tx, executionId: string) =>
  (await tx.select({ date: routeExecutions.date, code: operations.code }).from(routeExecutions).innerJoin(operations, eq(operations.id, routeExecutions.operationId)).where(eq(routeExecutions.id, executionId)))[0];

/** Puts someone on the day's list before they have a driver code. */
export const addPerson = createServerFn({ method: 'POST' })
  .validator(z.object({ date: isoDate, driverId: uuid, operation }))
  .handler(({ data }) => run('drivers.confirm_today', (tx, actor) => addPersonToday(tx, actor, data)));

export const setPerson = createServerFn({ method: 'POST' })
  .validator(z.object({ executionId: uuid, driverId: uuid }))
  .handler(({ data }) => run('drivers.confirm_today', (tx, actor) => setPersonToday(tx, actor, data)));

/** "Didn't work today" on someone without a driver code. Returns what Undo needs. */
export const removePerson = createServerFn({ method: 'POST' })
  .validator(z.object({ executionId: uuid }))
  .handler(({ data }) => run('drivers.confirm_today', (tx, actor) => removePersonToday(tx, actor, data)));

export const savePersonSortCodes = createServerFn({ method: 'POST' })
  .validator(z.object({ executionId: uuid, sortCodeIds: z.array(uuid).max(20) }))
  .handler(({ data }) => run('drivers.confirm_today', (tx, actor) => setPersonSortCodes(tx, actor, data)));

/** Gives a person a driver code (or changes it); a typed code that doesn't exist yet is created. */
export const giveCode = createServerFn({ method: 'POST' })
  .validator(z.object({
    date: isoDate, from: z.union([z.object({ routeId: uuid }), z.object({ executionId: uuid })]),
    to: z.union([z.object({ routeId: uuid }), z.object({ newCode: z.string().min(1).max(20) })]), operation,
    swap: z.boolean().optional(),
  }))
  .handler(({ data }) => run('drivers.confirm_today', async (tx, actor) => {
    const res = await moveToCode(tx, actor, data);
    await recheckForDate(tx, actor, data.date, data.operation);
    return res;
  }));

/** "Confirm and send list": confirms the usual drivers and emails the list to the people marked for it. */
export const sendList = createServerFn({ method: 'POST' })
  .validator(z.object({ date: isoDate, operation }))
  .handler(({ data }) => run('drivers.confirm_today', async (tx, actor) => {
    const res = await sendDayList(tx, actor, data.date, data.operation);
    await recheckForDate(tx, actor, data.date, data.operation);
    return res;
  }));

/** The status chosen on a row: Confirmed, To confirm, or Didn't run today (T-Force). Returns what Undo needs. */
export const setStatus = createServerFn({ method: 'POST' })
  .validator(z.union([
    z.object({ date: isoDate, routeId: uuid, status: z.enum(['confirmed', 'proposed', 'off']) }),
    z.object({ executionId: uuid, status: z.enum(['confirmed', 'proposed']) }),
  ]))
  .handler(({ data }) => run('drivers.confirm_today', async (tx, actor) => {
    if ('executionId' in data) return { previous: null, personStatus: await setPersonStatus(tx, actor, data) };
    const res = await setRouteStatus(tx, actor, data);
    await recheckRoute(tx, actor, data.date, data.routeId);
    return { previous: res.previous, personStatus: null };
  }));

/** The × on a line with a driver code: off the day's list (didn't run, kept for the history). */
export const removeRow = createServerFn({ method: 'POST' })
  .validator(z.object({ date: isoDate, routeId: uuid }))
  .handler(({ data }) => run('drivers.confirm_today', async (tx, actor) => {
    const res = await removeRouteRow(tx, actor, data);
    await recheckRoute(tx, actor, data.date, data.routeId);
    return res;
  }));

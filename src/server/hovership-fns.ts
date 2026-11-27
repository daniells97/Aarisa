import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { todayLA } from '~/domain/dates';
import { db } from '~/db/client';
import { read, run } from './fn';
import { requireSignedIn } from './auth';
import { importHovership, latestHovershipWeek, loadHovershipWeek, resolveUnknownCode, setBonus } from './hovership';
import { classifyOtherRevenue } from './revenue';
import { setHovershipStatus, coverHovership, restoreHovership, addHovershipPerson, setOnHovership, confirmUsualHovership, sendHovershipList as sendHovershipDayList, loadHovershipDay, setHovershipRoutes, setHovershipUsual, unconfirmUsualHovership } from './hovership-day';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
// Any contract whose report names the driver; omitted = the first one (Hovership).
const operation = z.string().regex(/^[a-z0-9_]{1,40}$/).optional();

export const getDefaultHovershipWeek = createServerFn({ method: 'GET' })
  .validator(z.object({ operation }).optional())
  .handler(async ({ data }) => {
    await requireSignedIn();
    return db().transaction((tx) => latestHovershipWeek(tx, todayLA(), data?.operation));
  });

export const getHovershipWeek = createServerFn({ method: 'GET' })
  .validator(z.object({ start: isoDate, operation }))
  .handler(({ data }) => read('payroll.view', (tx, actor) => loadHovershipWeek(tx, actor, data.start, data.operation)));

export const uploadHovershipReport = createServerFn({ method: 'POST' })
  .validator(z.object({
    fileName: z.string().max(200),
    text: z.string().max(5_000_000),
    columnOverride: z.record(z.string().uuid(), z.string().max(100)).optional(),
    operation,
  }))
  .handler(({ data }) => run('reports.import', (tx, actor) => importHovership(tx, actor, data)));

export const resolveHovershipCode = createServerFn({ method: 'POST' })
  .validator(z.object({
    exceptionId: z.string().uuid(),
    resolution: z.discriminatedUnion('action', [
      z.object({ action: z.literal('new_driver'), fullName: z.string().max(120) }),
      z.object({ action: z.literal('match'), driverId: z.string().uuid() }),
    ]),
  }))
  .handler(({ data }) => run('exceptions.clear', async (tx, actor) => (await resolveUnknownCode(tx, actor, data.exceptionId, data.resolution)).driverId));

export const saveBonus = createServerFn({ method: 'POST' })
  .validator(z.object({ driverId: z.string().uuid(), date: isoDate, bonusCents: z.number().int().min(0).max(5_000_00), operation }))
  .handler(({ data }) => run('hovership.enter_bonus', async (tx, actor) => (await setBonus(tx, actor, data)).bonusCents));

export const classifyStem = createServerFn({ method: 'POST' })
  .validator(z.object({
    id: z.string().uuid(),
    classification: z.union([
      z.object({ zoneId: z.string().uuid() }),
      z.object({ newZone: z.string().min(1).max(80) }),
      z.object({ lumpAdjustment: z.string().min(1).max(200) }),
    ]),
  }))
  .handler(({ data }) => run('reports.import', async (tx, actor) => (await classifyOtherRevenue(tx, actor, data.id, data.classification)).id));

export const getHovershipDay = createServerFn({ method: 'GET' })
  .validator(z.object({ date: isoDate, operation }))
  .handler(({ data }) => read('payroll.view', (tx, actor) => loadHovershipDay(tx, actor, data.date, data.operation)));

export const saveHovershipRoutes = createServerFn({ method: 'POST' })
  .validator(z.object({ date: isoDate, driverId: z.string().uuid(), sortCodeIds: z.array(z.string().uuid()).max(20), operation }))
  .handler(({ data }) => run('drivers.confirm_today', (tx, actor) => setHovershipRoutes(tx, actor, data)));

export const confirmHovershipUsual = createServerFn({ method: 'POST' })
  .validator(z.object({ date: isoDate, operation }))
  .handler(({ data }) => run('drivers.confirm_today', (tx, actor) => confirmUsualHovership(tx, actor, data.date, data.operation)));

/** "Confirm and send list": confirms the usual routes and emails the day's list to the people marked for it. */
export const sendHovershipList = createServerFn({ method: 'POST' })
  .validator(z.object({ date: isoDate, operation }))
  .handler(({ data }) => run('drivers.confirm_today', (tx, actor) => sendHovershipDayList(tx, actor, data.date, data.operation)));

export const unconfirmHovershipUsual = createServerFn({ method: 'POST' })
  .validator(z.object({ date: isoDate, operation }))
  .handler(({ data }) => run('drivers.confirm_today', (tx, actor) => unconfirmUsualHovership(tx, actor, data.date, data.operation)));

export const saveHovershipUsual = createServerFn({ method: 'POST' })
  .validator(z.object({ driverId: z.string().uuid(), sortCodeIds: z.array(z.string().uuid()).max(20), operation }))
  .handler(({ data }) => run('setup.edit', (tx, actor) => setHovershipUsual(tx, actor, data)));

export const addHovershipDriver = createServerFn({ method: 'POST' })
  .validator(z.union([z.object({ driverId: z.string().uuid() }), z.object({ newName: z.string().min(1).max(120) })]))
  .handler(({ data }) => run('drivers.confirm_today', (tx, actor) => addHovershipPerson(tx, actor, data)));

export const setHovershipDriverOnList = createServerFn({ method: 'POST' })
  .validator(z.object({ driverId: z.string().uuid(), on: z.boolean() }))
  .handler(({ data }) => run('drivers.confirm_today', (tx, actor) => setOnHovership(tx, actor, data.driverId, data.on)));

export const coverHovershipDriver = createServerFn({ method: 'POST' })
  .validator(z.object({ date: isoDate, driverId: z.string().uuid(), by: z.union([z.object({ driverId: z.string().uuid() }), z.object({ newName: z.string().min(1).max(120) })]), operation }))
  .handler(({ data }) => run('drivers.confirm_today', (tx, actor) => coverHovership(tx, actor, data)));

export const restoreHovershipDrivers = createServerFn({ method: 'POST' })
  .validator(z.object({ date: isoDate, previous: z.array(z.object({ driverId: z.string().uuid(), sortCodeIds: z.array(z.string().uuid()).max(20).nullable(), off: z.boolean().optional() })).max(40), operation }))
  .handler(({ data }) => run('drivers.confirm_today', (tx, actor) => restoreHovership(tx, actor, data)));

/** The status chosen on a Hovership line: Confirmed, To confirm, Didn't work (keeps the person and routes). */
export const setHovershipRowStatus = createServerFn({ method: 'POST' })
  .validator(z.object({ date: isoDate, driverId: z.string().uuid(), status: z.enum(['confirmed', 'proposed', 'off']), operation }))
  .handler(({ data }) => run('drivers.confirm_today', (tx, actor) => setHovershipStatus(tx, actor, data)));

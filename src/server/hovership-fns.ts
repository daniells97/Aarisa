import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { todayLA } from '~/domain/dates';
import { db } from '~/db/client';
import { read, run } from './fn';
import { requireSignedIn } from './auth';
import { importHovership, latestHovershipWeek, loadHovershipWeek, resolveUnknownCode, setBonus } from './hovership';
import { REQUIRED, OPTIONAL } from '~/integrations/hovership';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const fields = z.enum([...REQUIRED, ...OPTIONAL] as [string, ...string[]]);

export const getDefaultHovershipWeek = createServerFn({ method: 'GET' }).handler(async () => {
  await requireSignedIn();
  return db().transaction((tx) => latestHovershipWeek(tx, todayLA()));
});

export const getHovershipWeek = createServerFn({ method: 'GET' })
  .validator(z.object({ start: isoDate }))
  .handler(({ data }) => read('payroll.view', (tx, actor) => loadHovershipWeek(tx, actor, data.start)));

export const uploadHovershipReport = createServerFn({ method: 'POST' })
  .validator(z.object({
    fileName: z.string().max(200),
    text: z.string().max(5_000_000),
    columnOverride: z.record(fields, z.string().max(100)).optional(),
  }))
  .handler(({ data }) => run('hovership.import', (tx, actor) => importHovership(tx, actor, data)));

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
  .validator(z.object({ driverId: z.string().uuid(), date: isoDate, bonusCents: z.number().int().min(0).max(5_000_00) }))
  .handler(({ data }) => run('hovership.enter_bonus', async (tx, actor) => (await setBonus(tx, actor, data)).bonusCents));

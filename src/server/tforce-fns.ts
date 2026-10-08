import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { todayLA } from '~/domain/dates';
import { db } from '~/db/client';
import { requireSignedIn } from './auth';
import { read, run } from './fn';
import { importTforce, latestTforceWeek, loadTforceWeek, resolveTforceException } from './tforce';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const uuid = z.string().uuid();

export const getDefaultTforceWeek = createServerFn({ method: 'GET' }).handler(async () => {
  await requireSignedIn();
  return db().transaction((tx) => latestTforceWeek(tx, todayLA()));
});

export const getTforceWeek = createServerFn({ method: 'GET' })
  .validator(z.object({ start: isoDate }))
  .handler(({ data }) => read('payroll.view', (tx, actor) => loadTforceWeek(tx, actor, data.start)));

export const uploadTforceReport = createServerFn({ method: 'POST' })
  .validator(z.object({ fileName: z.string().max(200), text: z.string().max(5_000_000), columnOverride: z.record(z.enum(['order_date', 'route', 'pieces']), z.string().max(100)).optional() }))
  .handler(({ data }) => run('reports.import', (tx, actor) => importTforce(tx, actor, data)));

export const resolveException = createServerFn({ method: 'POST' })
  .validator(z.object({
    exceptionId: uuid,
    resolution: z.discriminatedUnion('action', [
      z.object({ action: z.literal('assign'), payee: z.union([z.object({ driverId: uuid }), z.object({ contractorId: uuid })]) }),
      z.object({ action: z.literal('not_ours') }),
      z.object({ action: z.literal('pay_as_reported') }),
      z.object({ action: z.literal('ask_client'), note: z.string().max(300).optional() }),
    ]),
  }))
  .handler(({ data }) => run('exceptions.clear', async (tx, actor) => (await resolveTforceException(tx, actor, data.exceptionId, data.resolution)).id));

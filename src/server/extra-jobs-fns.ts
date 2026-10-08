import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { read, run } from './fn';
import { EXTRA_SERVICES, completeExtraJob, createExtraJob, extraJobOptions, listExtraJobs } from './extra-jobs';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const uuid = z.string().uuid();
const cents = z.number().int().min(0).max(100_000_00);

export const getExtraJobs = createServerFn({ method: 'GET' })
  .validator(z.object({ from: isoDate, to: isoDate }))
  .handler(({ data }) => read('payroll.view', (tx, actor) => listExtraJobs(tx, actor, data.from, data.to)));

export const getExtraJobOptions = createServerFn({ method: 'GET' }).handler(() => read('extra_jobs.log', (tx, actor) => extraJobOptions(tx, actor)));

export const saveExtraJob = createServerFn({ method: 'POST' })
  .validator(z.object({
    clientUuid: uuid, service: z.enum(EXTRA_SERVICES), date: isoDate, nearRouteId: uuid.nullable(),
    payee: z.union([z.object({ driverId: uuid }), z.object({ contractorId: uuid })]),
    clientAmountCents: cents.nullable(), driverAmountCents: cents, orderNumber: z.string().max(60).nullable(), note: z.string().max(500).nullable(),
  }))
  .handler(({ data }) => run('extra_jobs.log', async (tx, actor) => {
    const { job, created } = await createExtraJob(tx, actor, data);
    return { id: job.id, created };
  }));

export const fillExtraJob = createServerFn({ method: 'POST' })
  .validator(z.object({ id: uuid, orderNumber: z.string().max(60).nullable().optional(), clientAmountCents: cents.nullable().optional() }))
  .handler(({ data }) => run('payroll.view', async (tx, actor) => {
    const { id, ...patch } = data;
    return (await completeExtraJob(tx, actor, id, patch)).id;
  }));

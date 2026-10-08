import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { read, run } from './fn';
import { approveRun, listRuns, loadRun, markRunPaid, reopenRun } from './payroll';

const runId = z.string().regex(/^(hovership|tforce)-\d{4}-\d{2}-\d{2}$/);

export const getRuns = createServerFn({ method: 'GET' }).handler(() => read('payroll.view', (tx, actor) => listRuns(tx, actor)));

export const getRun = createServerFn({ method: 'GET' })
  .validator(z.object({ runId }))
  .handler(({ data }) => read('payroll.view', (tx, actor) => loadRun(tx, actor, data.runId)));

export const approve = createServerFn({ method: 'POST' })
  .validator(z.object({ runId, expectedPayCents: z.number().int() }))
  .handler(({ data }) => run('payroll.approve', async (tx, actor) => (await approveRun(tx, actor, data.runId, data.expectedPayCents)).id));

export const reopen = createServerFn({ method: 'POST' })
  .validator(z.object({ runId }))
  .handler(({ data }) => run('payroll.reopen', async (tx, actor) => (await reopenRun(tx, actor, data.runId)).id));

export const markPaid = createServerFn({ method: 'POST' })
  .validator(z.object({ runId }))
  .handler(({ data }) => run('payroll.approve', async (tx, actor) => (await markRunPaid(tx, actor, data.runId)).id));

import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { todayLA } from '~/domain/dates';
import { read, run } from './fn';
import { addDriverNote, addLoan, deductLoan, ledgerOverview, loadDriverFile, loansForRun, removeDeduction, setNoteResolved } from './driver-ledger';

const uuid = z.string().uuid();
const runId = z.string().regex(/^[a-z0-9_]+-\d{4}-\d{2}-\d{2}$/);
const cents = z.number().int().min(1).max(100_000_00);

export const getDriverFile = createServerFn({ method: 'GET' })
  .validator(z.object({ driverId: uuid }))
  .handler(({ data }) => read('payroll.view', (tx, actor) => loadDriverFile(tx, actor, data.driverId, todayLA())));

export const createDriverNote = createServerFn({ method: 'POST' })
  .validator(z.object({ driverId: uuid, body: z.string().max(1000) }))
  .handler(({ data }) => run('drivers.confirm_today', async (tx, actor) => (await addDriverNote(tx, actor, data)).id));

export const resolveDriverNote = createServerFn({ method: 'POST' })
  .validator(z.object({ id: uuid, resolved: z.boolean() }))
  .handler(({ data }) => run('drivers.confirm_today', async (tx, actor) => (await setNoteResolved(tx, actor, data.id, data.resolved)).id));

export const createLoan = createServerFn({ method: 'POST' })
  .validator(z.object({ driverId: uuid, kind: z.enum(['loan', 'advance']), amountCents: cents, givenOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), note: z.string().max(300).nullable() }))
  .handler(({ data }) => run('payroll.view', async (tx, actor) => (await addLoan(tx, actor, data)).id)); // addLoan checks who may

export const getRunLoans = createServerFn({ method: 'GET' })
  .validator(z.object({ runId }))
  .handler(({ data }) => read('payroll.view', (tx, actor) => loansForRun(tx, actor, data.runId, todayLA())));

export const deductFromRun = createServerFn({ method: 'POST' })
  .validator(z.object({ loanId: uuid, runId, amountCents: cents }))
  .handler(({ data }) => run('payroll.approve', async (tx, actor) => (await deductLoan(tx, actor, data)).id));

export const undoDeduction = createServerFn({ method: 'POST' })
  .validator(z.object({ adjustmentId: uuid, runId }))
  .handler(({ data }) => run('payroll.approve', async (tx, actor) => { await removeDeduction(tx, actor, data); return true; }));

export const getLedgerOverview = createServerFn({ method: 'GET' }).handler(() => read('payroll.view', (tx, actor) => ledgerOverview(tx, actor, todayLA())));

import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { todayLA } from '~/domain/dates';
import { read, run } from './fn';
import { claimDetails, loadSettlements, markClaimReady, markClaimSent, recordPayment } from './settlements';

const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const getSettlements = createServerFn({ method: 'GET' })
  .validator(z.object({ filter: z.enum(['all', 'hovership', 'tforce']) }))
  .handler(({ data }) => read('money.view', (tx, actor) => loadSettlements(tx, actor, todayLA(), data.filter)));

export const getClaim = createServerFn({ method: 'GET' })
  .validator(z.object({ lineId: uuid }))
  .handler(({ data }) => read('money.view', (tx, actor) => claimDetails(tx, actor, data.lineId, todayLA())));

export const savePayment = createServerFn({ method: 'POST' })
  .validator(z.object({
    operation: z.enum(['hovership', 'tforce']), receivedOn: isoDate, amountCents: z.number().int().positive().max(10_000_000_00),
    method: z.string().max(40).nullable(), reference: z.string().max(80).nullable(), note: z.string().max(300).nullable(),
    allocations: z.array(z.object({ lineId: uuid, amountCents: z.number().int().positive() })).max(100),
  }))
  .handler(({ data }) => run('settlements.record', async (tx, actor) => (await recordPayment(tx, actor, data)).id));

export const claimReady = createServerFn({ method: 'POST' })
  .validator(z.object({ lineId: uuid }))
  .handler(({ data }) => run('settlements.record', async (tx, actor) => (await markClaimReady(tx, actor, data.lineId)).id));

export const claimSent = createServerFn({ method: 'POST' })
  .validator(z.object({ lineId: uuid, sentTo: z.string().max(200).nullable() }))
  .handler(({ data }) => run('settlements.record', async (tx, actor) => (await markClaimSent(tx, actor, data.lineId, data.sentTo)).id));

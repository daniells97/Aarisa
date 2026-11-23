import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { todayLA } from '~/domain/dates';
import { read } from './fn';
import { loadOverview } from './overview';
import { ledgerOverview } from './driver-ledger';

export const getOverview = createServerFn({ method: 'GET' })
  .validator(z.object({ week: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }))
  .handler(({ data }) => read('payroll.view', async (tx, actor) => ({ ...(await loadOverview(tx, actor, todayLA(), data.week)), ledger: await ledgerOverview(tx, actor, todayLA()) })));

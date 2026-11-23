import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { todayLA } from '~/domain/dates';
import { read } from './fn';
import { loadHistory } from './history';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const getHistory = createServerFn({ method: 'GET' })
  .validator(z.object({ from: isoDate, to: isoDate, operation: z.string().regex(/^[a-z0-9_]{1,40}$/).optional(), driverId: z.string().uuid().optional(), routeId: z.string().uuid().optional() }))
  .handler(({ data }) => read('payroll.view', (tx, actor) => loadHistory(tx, actor, data, todayLA())));

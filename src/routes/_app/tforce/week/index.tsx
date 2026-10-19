import { createFileRoute, redirect } from '@tanstack/react-router';
import { z } from 'zod';
import { getDefaultTforceWeek } from '~/server/tforce-fns';

export const Route = createFileRoute('/_app/tforce/week/')({
  validateSearch: z.object({ op: z.string().regex(/^[a-z0-9_]{1,40}$/).optional() }),
  beforeLoad: async ({ search }) => {
    const weekId = await getDefaultTforceWeek({ data: { operation: search.op } });
    throw redirect({ to: '/tforce/week/$weekId', params: { weekId }, search: search.op ? { op: search.op } : {} });
  },
});

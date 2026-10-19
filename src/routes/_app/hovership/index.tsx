import { createFileRoute, redirect } from '@tanstack/react-router';
import { z } from 'zod';
import { getDefaultHovershipWeek } from '~/server/hovership-fns';

export const Route = createFileRoute('/_app/hovership/')({
  validateSearch: z.object({ op: z.string().regex(/^[a-z0-9_]{1,40}$/).optional() }),
  beforeLoad: async ({ search }) => {
    const weekId = await getDefaultHovershipWeek({ data: { operation: search.op } });
    throw redirect({ to: '/hovership/week/$weekId', params: { weekId }, search: search.op ? { op: search.op } : {} });
  },
});

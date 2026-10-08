import { createFileRoute, redirect } from '@tanstack/react-router';
import { getDefaultTforceWeek } from '~/server/tforce-fns';

export const Route = createFileRoute('/_app/tforce/week/')({
  beforeLoad: async () => {
    const weekId = await getDefaultTforceWeek();
    throw redirect({ to: '/tforce/week/$weekId', params: { weekId } });
  },
});

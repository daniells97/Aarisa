import { createFileRoute, redirect } from '@tanstack/react-router';
import { getDefaultHovershipWeek } from '~/server/hovership-fns';

export const Route = createFileRoute('/_app/hovership/')({
  beforeLoad: async () => {
    const weekId = await getDefaultHovershipWeek();
    throw redirect({ to: '/hovership/week/$weekId', params: { weekId } });
  },
});

import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { getOverview } from '~/server/overview-fns';
import { Overview } from '~/ui/Overview';

const search = z.object({ week: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() });

export const Route = createFileRoute('/_app/')({
  validateSearch: search,
  loaderDeps: ({ search: s }) => ({ week: s.week }),
  loader: async ({ deps }) => ({ data: await getOverview({ data: deps }), hourLA: hourInLA() }),
  component: () => {
    const { data, hourLA } = Route.useLoaderData();
    const { user } = Route.useRouteContext();
    return <Overview data={data} userName={user.name} hourLA={hourLA} weekPath="/" />;
  },
});

export function hourInLA() {
  return Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', hourCycle: 'h23' }).format(new Date()));
}

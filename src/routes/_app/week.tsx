import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { getOverview } from '~/server/overview-fns';
import { Overview } from '~/ui/Overview';
import { hourInLA } from './index';

// "This week" tab on the phone: the same overview (spec 6.2).
export const Route = createFileRoute('/_app/week')({
  validateSearch: z.object({ week: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }),
  loaderDeps: ({ search: s }) => ({ week: s.week }),
  loader: async ({ deps }) => ({ data: await getOverview({ data: deps }), hourLA: hourInLA() }),
  component: () => {
    const { data, hourLA } = Route.useLoaderData();
    const { user } = Route.useRouteContext();
    return <Overview data={data} userName={user.name} hourLA={hourLA} weekPath="/week" />;
  },
});

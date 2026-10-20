import { Link, createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { useT } from '~/i18n';
import { getDefaultTforceWeek, getTforceWeek } from '~/server/tforce-fns';
import { PageHead, Panel, useFormat } from '~/ui';
import { ExceptionCard, ResolvedList } from '~/ui/TforceExceptions';

// Phone Exceptions tab (Mobile-Exceptions design): the open weekly-check exceptions, one card each.
export const Route = createFileRoute('/_app/exceptions')({
  validateSearch: z.object({ week: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }),
  loaderDeps: ({ search }) => ({ week: search.week }),
  loader: async ({ deps }) => getTforceWeek({ data: { start: deps.week ?? (await getDefaultTforceWeek()) } }),
  component: ExceptionsPage,
});

function ExceptionsPage() {
  const t = useT();
  const f = useFormat();
  const week = Route.useLoaderData();
  const open = week.exceptions.filter((e) => e.status === 'open');
  const range = `${f.date(week.week.start, { month: 'long', day: 'numeric' })} – ${f.date(week.days.at(-1)!, { month: 'long', day: 'numeric' })}`;
  return (
    <>
      <PageHead title={t('wk.exceptions')} lead={<>{t('wk.mobileTitle', { range })}. {open.length ? t('wk.mobileLead') : t('wk.allClear')}</>}
        actions={<Link to="/tforce/week/$weekId" params={{ weekId: week.week.start }}>{t('wk.title')}</Link>} />
      <Panel>
        {open.length === 0 ? <p className="panel-body muted" style={{ paddingTop: 20, margin: 0 }}>{t('wk.noExceptions')}</p>
          : <ul className="ex-list">{open.map((e) => <ExceptionCard key={e.id} ex={e} week={week} />)}</ul>}
        <ResolvedList items={week.exceptions.filter((e) => e.status === 'resolved')} />
      </Panel>
    </>
  );
}

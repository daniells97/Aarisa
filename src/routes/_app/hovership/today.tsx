import { Link, createFileRoute, useRouter } from '@tanstack/react-router';
import { z } from 'zod';
import { useT, type MessageKey } from '~/i18n';
import { addDays, todayLA } from '~/domain/dates';
import { getHovershipDay, saveHovershipRoutes } from '~/server/hovership-fns';
import { Icon, PageHead, Panel, Pill, useToast } from '~/ui';
import { DayTabs } from '~/ui/DayTabs';
import { SortCodes } from '~/ui/SortCodes';

export const Route = createFileRoute('/_app/hovership/today')({
  validateSearch: z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }),
  loaderDeps: ({ search }) => ({ date: search.date ?? todayLA() }),
  loader: ({ deps }) => getHovershipDay({ data: { date: deps.date } }),
  component: HovershipTodayPage,
});

type Day = Awaited<ReturnType<typeof getHovershipDay>>;

function HovershipTodayPage() {
  const t = useT();
  const day = Route.useLoaderData();
  const router = useRouter();
  const toast = useToast();
  const dateLabel = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${day.date}T12:00:00Z`));
  const s = day.summary;

  const routesOf = (r: Day['rows'][number]) => (
    <SortCodes value={r.sortCodes} options={day.options.sortCodes} disabled={!day.canEdit} label={t('hd.routesOf', { name: r.name, date: dateLabel })}
      onChange={async (ids) => {
        const res = await saveHovershipRoutes({ data: { date: day.date, driverId: r.driverId, sortCodeIds: ids } });
        if (!res.ok) return toast(t(`error.${res.code}` as MessageKey));
        await router.invalidate();
      }} />
  );

  return (
    <>
      <PageHead title={t('td.title')} lead={t('hd.lead', { client: day.operation.name })}
        actions={
          <div className="week-nav">
            <Link to="/hovership/today" search={{ date: addDays(day.date, -1) }} aria-label={t('td.prevDay')}><Icon name="chevronLeft" width={18} height={18} /></Link>
            <span className="num">{dateLabel}</span>
            <Link to="/hovership/today" search={{ date: addDays(day.date, 1) }} aria-label={t('td.nextDay')}><Icon name="chevronRight" width={18} height={18} /></Link>
          </div>
        } />
      <DayTabs current="hovership" date={day.date} />
      {!day.canEdit && <p className="notice notice-info" style={{ margin: 0 }}>{t('td.readOnly')}</p>}

      <div className="row" role="list" aria-label={t('td.status')}>
        <span role="listitem"><Pill tone="ok">{t('hd.working', { count: s.working })}</Pill></span>
        <span role="listitem" className="muted">{t('hd.people', { count: s.drivers })}</span>
      </div>
      {(s.unassigned.length > 0 || s.shared.length > 0) && (
        <div className="notice" role="status" style={{ margin: 0, flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}>
          {s.unassigned.length > 0 && <span>{t('hd.unassigned', { routes: s.unassigned.join(', ') })}</span>}
          {s.shared.map((x) => <span key={x.code}>{t('hd.shared', { route: x.code, who: x.who.join(', ') })}</span>)}
        </div>
      )}

      <div className="today-layout">
        <div className="today-list"><Panel>
          {day.rows.length === 0 ? <p className="panel-body" style={{ paddingTop: 20, margin: 0 }}>{t('hd.noPeople')}</p> : (
            <>
              <div className="table-wrap desktop-only">
                <table>
                  <thead><tr><th scope="col">{t('hd.person')}</th><th scope="col">{t('td.sortCode')}</th></tr></thead>
                  <tbody>
                    {day.rows.map((r) => (
                      <tr key={r.driverId}>
                        <td><strong>{r.name}</strong>{r.code && <span className="sub">{r.code}</span>}</td>
                        <td>{routesOf(r)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <ul className="route-cards phone-only">
                {day.rows.map((r) => (
                  <li key={r.driverId}>
                    <strong>{r.name}</strong>{r.code && <span className="sub">{r.code}</span>}
                    {routesOf(r)}
                  </li>
                ))}
              </ul>
            </>
          )}
        </Panel></div>
        <div className="stack today-aside today-aside-after">
          <Panel title={t('td.changesTitle')} id="changes">
            <div className="panel-body">
              {day.changes.length === 0 ? <p className="muted" style={{ margin: 0 }}>{t('td.noChanges')}</p> : (
                <ol className="change-log">
                  {day.changes.map((c) => (
                    <li key={c.id}>
                      <span className="num muted">{new Intl.DateTimeFormat(undefined, { timeZone: 'America/Los_Angeles', hour: 'numeric', minute: '2-digit' }).format(new Date(c.at))}</span>
                      <span>
                        <strong>{c.driver}</strong> {t('td.routesSet', { routes: c.sortCodes.join(', ') || t('td.noSortCodes') })}
                        {c.user && <span className="sub">{t('td.by', { who: c.user, source: t(`audit.source.${c.source}` as MessageKey) })}</span>}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </Panel>
        </div>
      </div>
    </>
  );
}

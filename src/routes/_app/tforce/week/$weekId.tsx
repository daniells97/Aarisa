import { useRef, useState } from 'react';
import { Link, createFileRoute, notFound, useRouter } from '@tanstack/react-router';
import { useT, type MessageKey } from '~/i18n';
import { addDays, weekStart } from '~/domain/dates';
import { getTforceWeek, uploadTforceReport } from '~/server/tforce-fns';
import type { TforceImportOutcome } from '~/server/tforce';
import { Button, Figures, Icon, ImportNotice, PageHead, Panel, ReadingSteps, RoutePlate, WarningDiamond, buttonClass, useFormat, useToast } from '~/ui';
import { ExceptionCard, ResolvedList } from '~/ui/TforceExceptions';

type Week = Awaited<ReturnType<typeof getTforceWeek>>;

export const Route = createFileRoute('/_app/tforce/week/$weekId')({
  beforeLoad: ({ params }) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(params.weekId) || weekStart(params.weekId) !== params.weekId) throw notFound();
  },
  loader: ({ params }) => getTforceWeek({ data: { start: params.weekId } }),
  component: WeeklyCheck,
});

function WeeklyCheck() {
  const t = useT();
  const f = useFormat();
  const week = Route.useLoaderData();
  const router = useRouter();
  const toast = useToast();
  const fileInput = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<TforceImportOutcome | null>(null);
  const [pending, setPending] = useState<{ fileName: string; text: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lastDay = week.days.at(-1)!;
  const range = `${f.date(week.week.start, { month: 'long', day: 'numeric' })} – ${f.date(lastDay, { month: 'long', day: 'numeric' })}`;
  const hasReport = week.summary.routeDays > 0;
  const open = week.exceptions.filter((e) => e.status === 'open');

  const send = async (file: { fileName: string; text: string }, columnOverride?: Record<string, string>) => {
    setError(null); setOutcome(null); setReading(file.fileName);
    try {
      const res = await uploadTforceReport({ data: { ...file, columnOverride } });
      if (!res.ok) return setError(t(`error.${res.code}` as MessageKey));
      setOutcome(res.value);
      setPending(res.value.status === 'layout_changed' ? file : null);
      if (res.value.status === 'done' || res.value.status === 'partial') {
        toast(t('wk.imported', { rows: res.value.rows, pieces: f.number(res.value.pieces) }));
        if (res.value.newRoutes.length) toast(t('wk.newRoutes', { routes: res.value.newRoutes.join(', ') }));
      }
      await router.invalidate();
    } catch {
      setError(t('error.generic'));
    } finally {
      setReading(null);
    }
  };
  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 5_000_000) return setError(t('error.file_too_big'));
    if (!/\.csv$/i.test(file.name) && file.type !== 'text/csv') return setError(t('error.not_csv'));
    await send({ fileName: file.name, text: await file.text() });
  };
  const upload = (label: MessageKey = 'wk.upload', primary = false) => week.canImport && (
    <Button variant={primary ? 'primary' : 'secondary'} onClick={() => fileInput.current?.click()} disabled={reading != null}>
      <Icon name="upload" width={18} height={18} />{t(label)}
    </Button>
  );

  const approveReason = open.length ? (open.length === 1 ? t('wk.clearFirstOne') : t('wk.clearFirst', { count: open.length })) : undefined;
  return (
    <>
      <PageHead title={t('wk.title')} lead={hasReport ? t('wk.lead', { range }) : t('wk.leadWaiting', { range })}
        actions={
          <div className="row" style={{ alignItems: 'flex-start' }}>
            <div className="week-nav">
              <Link to="/tforce/week/$weekId" params={{ weekId: addDays(week.week.start, -7) }} aria-label={t('hs.prevWeek')}><Icon name="chevronLeft" width={18} height={18} /></Link>
              <span className="num">{f.date(week.week.start, { month: 'short', day: 'numeric' })}</span>
              <Link to="/tforce/week/$weekId" params={{ weekId: addDays(week.week.start, 7) }} aria-label={t('hs.nextWeek')}><Icon name="chevronRight" width={18} height={18} /></Link>
            </div>
            {upload()}
            {hasReport && (approveReason
              ? <Button id="approve-week" variant="primary" disabledReason={approveReason}>{t('wk.approve')}</Button>
              : <Link className={buttonClass('primary')} to="/payroll/$runId" params={{ runId: week.runId }}>{t('wk.approve')}</Link>)}
          </div>
        } />
      <input ref={fileInput} type="file" accept=".csv,text/csv" hidden onChange={onFile} aria-label={t('wk.upload')} />
      {error && <p role="alert" className="notice" style={{ margin: 0 }}><WarningDiamond size={22} />{error}</p>}
      {week.locked && <p className="notice notice-info" style={{ margin: 0 }}>{t('wk.locked')}</p>}

      {reading ? <ReadingSteps fileName={reading} />
        : outcome?.status === 'layout_changed' ? (
          <ImportNotice title={t('imp.layoutTitle')} actions={<>
            {outcome.suggestions.filter((s) => s.header).map((s) => (
              <Button key={s.field} variant="primary" onClick={() => pending && send(pending, { [s.field]: s.header! })}>{t('imp.useColumn', { header: s.header! })}</Button>
            ))}
            {upload('hs.uploadOther')}
          </>}>
            {outcome.suggestions.map((s) => (
              <p key={s.field} style={{ margin: 0 }}>{t('imp.layoutMissing', { column: s.field === 'route' ? 'Paid Driver #' : s.field })} {s.header ? t('imp.layoutSuggest', { header: s.header }) : t('imp.layoutNoSuggest')}</p>
            ))}
            <p className="muted" style={{ margin: 0 }}>{t('imp.nothingSaved')}</p>
          </ImportNotice>
        ) : outcome?.status === 'failed' ? (
          <ImportNotice title={t(`imp.failed.${outcome.reason}`, { dates: (outcome.dates ?? []).map((d) => f.date(d, { month: 'short', day: 'numeric' })).join(', ') })} actions={upload('hs.uploadOther')} />
        ) : !hasReport ? (
          <ImportNotice tone="info" title={t('wk.waitingTitle', { range })} actions={upload('hs.uploadYourself', true)}>
            <p style={{ margin: 0 }}>{t('wk.waitingBody')}</p>
            {week.lastImportAt && <p className="muted" style={{ margin: 0 }}>{t('imp.lastArrived', { when: f.dateTime(week.lastImportAt) })}</p>}
          </ImportNotice>
        ) : null}

      {hasReport && <>
        <Panel>
          <Figures items={[
            { label: t('wk.piecesInReport'), value: f.number(week.summary.pieces), note: t('wk.routesDays', { routes: week.summary.routes, days: week.summary.routeDays }) },
            { label: t('wk.matched'), value: t('wk.matchedValue', { n: week.summary.matched, total: week.summary.routeDays }), note: t('wk.fromLists') },
            { label: t('wk.contractorDays'), value: f.number(week.summary.contractorRouteDays), note: week.summary.contractorRoutes.length ? t('wk.routesList', { routes: week.summary.contractorRoutes.join(', ') }) : undefined },
            { label: t('wk.exceptions'), value: <span className="row" style={{ gap: 8 }}>{open.length > 0 && <WarningDiamond size={26} />}{open.length}</span>, note: open.length ? t('wk.payrollWaits') : t('wk.allClear') },
          ]} />
        </Panel>
        <div className="week-layout">
          <Grid week={week} />
          <Panel title={t('wk.exceptions')} id="exceptions" aside={open.length > 0 && <span className="muted">{t('wk.openCount', { count: open.length })}</span>}>
            {open.length === 0 ? <p className="panel-body muted" style={{ margin: 0 }}>{t('wk.noExceptions')}</p> : (
              <ul className="ex-list">{open.map((e) => <ExceptionCard key={e.id} ex={e} week={week} />)}</ul>
            )}
            {open.some((e) => e.type === 'low_pieces' || e.type === 'no_pieces') && <p className="panel-body muted" style={{ margin: 0, paddingTop: 12, fontSize: 13.5 }}>{t('wk.askHint')}</p>}
            <ResolvedList items={week.exceptions.filter((e) => e.status === 'resolved')} />
          </Panel>
        </div>
      </>}
    </>
  );
}

function Grid({ week }: { week: Week }) {
  const t = useT();
  const f = useFormat();
  return (
    <Panel title={t('wk.gridTitle')} id="grid" aside={<span className="row muted" style={{ gap: 6, fontSize: 13.5 }}><span className="legend-flag" aria-hidden="true" />{t('wk.gridLegend')}</span>}>
      <div className="table-wrap">
        <table className="grid-table">
          <caption className="visually-hidden">{t('wk.gridCaption')}</caption>
          <thead>
            <tr>
              <th scope="col">{t('wk.route')}</th><th scope="col">{t('wk.driver')}</th>
              {week.days.map((d) => <th key={d} scope="col" className="cell">{f.date(d, { weekday: 'short' })}</th>)}
              <th scope="col" className="cell">{t('wk.week')}</th>
            </tr>
          </thead>
          <tbody>
            {week.grid.map((g) => {
              return (
                <tr key={g.route}>
                  <th scope="row" style={{ fontWeight: 400 }}><RoutePlate code={g.route} size="sm" /></th>
                  <td>{g.missingDay ? t('wk.missingDay', { day: f.date(g.missingDay, { weekday: 'long' }) }) : g.driver ?? (g.drivers > 1 ? t('wk.twoDrivers', { n: g.drivers }) : '–')}</td>
                  {g.cells.map((c, i) => (
                    <td key={i} className={`cell${c == null ? ' empty' : ''}${g.flags[i] ? ' flag' : ''}`}>
                      {c == null ? '–' : f.number(c)}{g.flags[i] && <span className="visually-hidden"> ({t('wk.flagged')})</span>}
                    </td>
                  ))}
                  <td className="cell"><strong>{f.number(g.total)}</strong></td>
                </tr>
              );
            })}
            <tr className="total-row">
              <th scope="row">{t('wk.total')}</th><td />
              {week.dailyTotals.map((n, i) => <td key={i} className="cell">{f.number(n)}</td>)}
              <td className="cell">{f.number(week.summary.pieces)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

import { Link, createFileRoute, useNavigate } from '@tanstack/react-router';
import { z } from 'zod';
import { useLocale, useT } from '~/i18n';
import { serviceLabel } from '~/ui/service-label';
import { addDays, todayLA } from '~/domain/dates';
import { MAX_RANGE_DAYS, historyRange, rangeTooLong, type HistoryPeriod } from '~/domain/history-range';
import { getHistory } from '~/server/history-fns';
import { Figures, Icon, PageHead, Panel, Pill, RoutePlate, SelectField, TextField, buttonClass, useFormat } from '~/ui';
import { useClientName } from '~/ui/ClientNames';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const search = z.object({
  period: z.enum(['day', 'week', 'month', 'range']).optional(),
  date: isoDate.optional(), from: isoDate.optional(), to: isoDate.optional(),
  op: z.string().regex(/^[a-z0-9_]{1,40}$/).optional(), driver: z.string().uuid().optional(), code: z.string().uuid().optional(),
});
type Search = z.infer<typeof search>;

function rangeOf(s: Search) {
  const r = historyRange(s.period ?? 'week', s.date ?? todayLA(), s.from, s.to);
  // A range over a year is cut to the year that ends on its last day.
  return rangeTooLong(r.from, r.to) ? { from: addDays(r.to, -(MAX_RANGE_DAYS - 1)), to: r.to, cut: true } : { ...r, cut: false };
}

export const Route = createFileRoute('/_app/history')({
  validateSearch: search,
  loaderDeps: ({ search: s }) => s,
  loader: ({ deps }) => {
    const r = rangeOf(deps);
    return getHistory({ data: { from: r.from, to: r.to, operation: deps.op, driverId: deps.driver, routeId: deps.code } });
  },
  component: HistoryPage,
});

function HistoryPage() {
  const t = useT();
  const f = useFormat();
  const clientName = useClientName();
  const locale = useLocale();
  const data = Route.useLoaderData();
  const s = Route.useSearch();
  const navigate = useNavigate({ from: '/history' });
  const period: HistoryPeriod = s.period ?? 'week';
  const date = s.date ?? todayLA();
  const range = rangeOf(s);
  const go = (patch: Partial<Search>) => navigate({ search: (prev) => ({ ...prev, ...patch }) });
  const step = (k: number) => {
    if (period === 'day') return go({ date: addDays(date, k) });
    if (period === 'week') return go({ date: addDays(date, 7 * k) });
    if (period === 'month') return go({ date: addDays(`${date.slice(0, 7)}-15`, 30 * k) });
  };
  const rangeLabel = range.from === range.to ? f.date(range.from, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
    : `${f.date(range.from)} – ${f.date(range.to)}`;
  const onePersonOneDay = !!s.driver && range.from === range.to;

  return (
    <>
      <PageHead title={t('hi.title')} lead={t('hi.lead')} />

      <Panel>
        <div className="panel-body stack" style={{ paddingTop: 20 }}>
          <div className="row" style={{ alignItems: 'flex-end' }}>
            <nav className="seg" aria-label={t('hi.period')}>
              {(['day', 'week', 'month', 'range'] as const).map((p) => (
                <Link key={p} to="/history" search={(prev) => ({ ...prev, period: p })} aria-current={period === p ? 'page' : undefined}>{t(`hi.p.${p}`)}</Link>
              ))}
            </nav>
            {period === 'range' ? (
              <>
                <TextField label={t('hi.from')} type="date" value={s.from ?? range.from} onChange={(e) => e.target.value && go({ from: e.target.value })} />
                <TextField label={t('hi.to')} type="date" value={s.to ?? range.to} onChange={(e) => e.target.value && go({ to: e.target.value })} />
              </>
            ) : (
              <div className="week-nav">
                <button type="button" className="icon-btn" onClick={() => step(-1)} aria-label={t('hi.prev')}><Icon name="chevronLeft" width={18} height={18} /></button>
                {period === 'month'
                  ? <input className="input" type="month" aria-label={t('hi.p.month')} value={date.slice(0, 7)} onChange={(e) => e.target.value && go({ date: `${e.target.value}-01` })} />
                  : <input className="input" type="date" aria-label={t(period === 'day' ? 'hi.p.day' : 'hi.p.week')} value={date} onChange={(e) => e.target.value && go({ date: e.target.value })} />}
                <button type="button" className="icon-btn" onClick={() => step(1)} aria-label={t('hi.next')}><Icon name="chevronRight" width={18} height={18} /></button>
              </div>
            )}
          </div>
          <div className="grid-3">
            <SelectField label={t('hi.contract')} value={s.op ?? ''} onChange={(e) => go({ op: e.target.value || undefined, code: undefined })}>
              <option value="">{t('hi.all')}</option>
              {data.options.operations.map((o) => <option key={o.code} value={o.code}>{clientName(o.code)}</option>)}
            </SelectField>
            <SelectField label={t('hi.person')} value={s.driver ?? ''} onChange={(e) => go({ driver: e.target.value || undefined })}>
              <option value="">{t('hi.everyone')}</option>
              {data.options.people.map((p) => <option key={p.id} value={p.id}>{p.name}{p.active ? '' : ` (${t('pill.inactive')})`}</option>)}
            </SelectField>
            {(!s.op || data.options.operations.find((o) => o.code === s.op)?.driverSource === 'daily_list') && (
              <SelectField label={t('hi.driverCode')} value={s.code ?? ''} onChange={(e) => go({ code: e.target.value || undefined })}>
                <option value="">{t('hi.all')}</option>
                {data.options.driverCodes.map((c) => <option key={c.id} value={c.id}>{c.code}</option>)}
              </SelectField>
            )}
          </div>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <p className="muted" style={{ margin: 0 }}>{rangeLabel}{range.cut ? ` · ${t('hi.cut', { days: MAX_RANGE_DAYS })}` : ''}</p>
            {(data.rows.length > 0 || data.extraJobs.length > 0 || data.loans.length > 0 || data.notes.length > 0) && (
              <a className={buttonClass()} title={t('hi.downloadHint')} download
                href={`/history-export?${new URLSearchParams({ from: range.from, to: range.to, ...(s.op ? { op: s.op } : {}), ...(s.driver ? { driver: s.driver } : {}), ...(s.code ? { code: s.code } : {}) })}`}>
                <Icon name="file" width={18} height={18} />{t('hi.download')}
              </a>
            )}
          </div>
        </div>
      </Panel>

      <Panel>
        <Figures items={[
          { label: t('hi.days'), value: f.number(data.totals.days) },
          { label: t('hi.people'), value: f.number(data.totals.people) },
          { label: t('hi.pieces'), value: f.number(data.totals.pieces), note: t('hi.piecesNote') },
        ]} />
      </Panel>

      {!s.driver && data.byPerson.length > 0 && (
        <Panel title={t('hi.byPerson')} id="by-person">
          <div className="table-wrap">
            <table>
              <thead><tr><th scope="col">{t('hi.person')}</th><th scope="col" className="r">{t('hi.days')}</th><th scope="col" className="r">{t('hi.pieces')}</th><th scope="col">{t('hi.driverCodes')}</th><th scope="col">{t('hi.routes')}</th></tr></thead>
              <tbody>
                {data.byPerson.map((p) => (
                  <tr key={p.key}>
                    <td>{p.driverId ? <Link to="/history" search={(prev) => ({ ...prev, driver: p.driverId! })}><strong>{p.name}</strong></Link> : <strong>{p.name}</strong>}</td>
                    <td className="r num">{p.days}</td>
                    <td className="r num">{f.number(p.pieces)}</td>
                    <td><span className="row" style={{ gap: 4 }}>{p.driverCodes.map((c) => <RoutePlate key={c} code={c} size="sm" />)}</span></td>
                    <td className="muted">{p.sortCodes.slice(0, 6).map((x) => (x.days > 1 ? `${x.code} ×${x.days}` : x.code)).join(', ')}{p.sortCodes.length > 6 ? '…' : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      <Panel title={onePersonOneDay ? t('hi.routesThatDay') : t('hi.detail')} id="detail">
        {data.rows.length === 0 ? <p className="panel-body muted" style={{ margin: 0 }}>{t('hi.none')}</p> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th scope="col">{t('hi.date')}</th><th scope="col">{t('hi.contract')}</th><th scope="col">{t('td.route')}</th><th scope="col">{t('hi.person')}</th><th scope="col">{t('hi.routes')}</th><th scope="col" className="r">{t('hi.pieces')}</th></tr></thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.id}>
                    <td className="num">{f.date(r.date, { weekday: 'short', month: 'short', day: 'numeric' })}</td>
                    <td>{clientName(r.operation)}</td>
                    <td>{r.driverCode ? <RoutePlate code={r.driverCode} size="sm" /> : <span className="muted">–</span>}</td>
                    <td>{r.name ?? (r.rawName ? `“${r.rawName}”` : <span className="muted">{t('td.noDriver')}</span>)}{r.company && r.driverId && <> <Pill tone="contractor">{r.company}</Pill></>}</td>
                    <td>{r.sortCodes.length ? <span className="sort-codes">{r.sortCodes.map((c) => <span key={c} className="sort-chip">{c}</span>)}</span> : <span className="muted">–</span>}</td>
                    <td className="r num">{r.pieces == null ? <span className="muted">–</span> : f.number(r.pieces)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data.truncated && <p className="panel-body muted" style={{ margin: 0 }}>{t('hi.truncated')}</p>}
      </Panel>

      <Panel title={t('hi.extraJobs')} id="extra-jobs">
        {data.extraJobs.length === 0 ? <p className="panel-body muted" style={{ margin: 0 }}>{t('hi.noExtra')}</p> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th scope="col">{t('hi.date')}</th><th scope="col">{t('hi.contract')}</th><th scope="col">{t('hi.person')}</th><th scope="col">{t('hi.service')}</th><th scope="col">{t('hi.order')}</th><th scope="col">{t('hi.note')}</th><th scope="col" className="r">{t('hi.driverPay')}</th></tr></thead>
              <tbody>
                {data.extraJobs.slice().reverse().map((j) => (
                  <tr key={j.id}>
                    <td className="num">{f.date(j.date, { weekday: 'short', month: 'short', day: 'numeric' })}</td>
                    <td>{clientName(j.operation)}</td>
                    <td>{j.name}</td>
                    <td>{serviceLabel(j.service, locale)}{j.nearRoute && <span className="sub">{t('hi.nearRoute')} {j.nearRoute}</span>}</td>
                    <td>{j.orderNumber ?? <span className="muted">–</span>}</td>
                    <td className="muted">{j.note ?? '–'}</td>
                    <td className="r num">{j.driverPay == null ? <span className="muted">–</span> : f.money(j.driverPay)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title={t('hi.loans')} id="loans">
        {data.loans.length === 0 ? <p className="panel-body muted" style={{ margin: 0 }}>{t('hi.noLoans')}</p> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th scope="col">{t('hi.date')}</th><th scope="col">{t('hi.person')}</th><th scope="col">{t('hi.type')}</th><th scope="col">{t('hi.note')}</th><th scope="col" className="r">{t('hi.amount')}</th></tr></thead>
              <tbody>
                {data.loans.slice().reverse().map((l) => (
                  <tr key={l.id}>
                    <td className="num">{f.date(l.date, { weekday: 'short', month: 'short', day: 'numeric' })}</td>
                    <td>{l.name}</td>
                    <td>{t(`df.kind.${l.kind}`)}</td>
                    <td className="muted">{l.note ?? '–'}</td>
                    <td className="r num">{l.amount == null ? <span className="muted">–</span> : f.money(l.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title={t('hi.notes')} id="notes">
        {data.notes.length === 0 ? <p className="panel-body muted" style={{ margin: 0 }}>{t('hi.noNotes')}</p> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th scope="col">{t('hi.date')}</th><th scope="col">{t('hi.person')}</th><th scope="col">{t('hi.note')}</th><th scope="col">{t('hi.by')}</th><th scope="col">{t('hi.state')}</th></tr></thead>
              <tbody>
                {data.notes.slice().reverse().map((n) => (
                  <tr key={n.id}>
                    <td className="num">{f.date(n.date, { weekday: 'short', month: 'short', day: 'numeric' })}</td>
                    <td>{n.name}</td>
                    <td>{n.body}</td>
                    <td className="muted">{n.author ?? '–'}</td>
                    <td>{n.resolved ? <Pill tone="muted">{t('hi.resolved')}</Pill> : <Pill tone="waiting">{t('hi.open')}</Pill>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}

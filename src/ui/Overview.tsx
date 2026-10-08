import type { ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { useT, type MessageKey } from '~/i18n';
import type { NeedItem } from '~/server/overview';
import type { getOverview } from '~/server/overview-fns';
import { PageHead } from './AppShell';
import { buttonClass } from './Button';
import { Icon } from './icons';
import { Figures, Panel } from './Panel';
import { WarningDiamond } from './WarningDiamond';
import { useFormat } from './format';
import { rangeText } from './payroll-text';
import { addDays } from '~/domain/dates';

type Data = Awaited<ReturnType<typeof getOverview>>;

function greeting(hour: number): MessageKey {
  return hour < 12 ? 'ov.morning' : hour < 18 ? 'ov.afternoon' : 'ov.evening';
}

/** Overview (spec 6.2). Same component on `/` (desktop) and `/week` (phone). */
export function Overview({ data, userName, hourLA, weekPath }: { data: Data; userName: string; hourLA: number; weekPath: '/' | '/week' }) {
  const t = useT();
  const f = useFormat();
  const range = rangeText(data.week, t, f);
  const n = data.needs.length;
  const lead = n === 0 ? t('ov.leadClear', { range }) : n === 1 ? t('ov.leadOne', { range }) : t('ov.leadNeeds', { range, count: n });
  const first = userName.split(' ')[0] ?? userName;
  const pct = data.figures.profitChangePct;
  const max = Math.max(1, ...data.perDay.map((d) => d.hovership));
  return (
    <>
      <PageHead title={t(greeting(hourLA), { name: first })} lead={lead}
        actions={
          <div className="week-nav">
            <Link to={weekPath} search={{ week: addDays(data.week.start, -7) }} aria-label={t('hs.prevWeek')}><Icon name="chevronLeft" width={18} height={18} /></Link>
            <span className="num">{f.date(data.week.start, { month: 'short', day: 'numeric' })} – {f.date(data.week.end, { month: 'short', day: 'numeric' })}</span>
            <Link to={weekPath} search={{ week: addDays(data.week.start, 7) }} aria-label={t('hs.nextWeek')}><Icon name="chevronRight" width={18} height={18} /></Link>
          </div>
        } />

      <Panel title={t('ov.needsTitle')} id="needs">
        {n === 0 ? <p className="panel-body muted" style={{ margin: 0 }}>{t('ov.allClear')}</p> : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {data.needs.map((item, i) => <Need key={i} item={item} />)}
          </ul>
        )}
      </Panel>

      <Panel>
        <Figures items={[
          { label: t('ov.packages'), value: f.number(data.figures.packages), note: t('ov.packagesNote') },
          { label: t('ov.routeDays'), value: f.number(data.figures.routeDays) },
          { label: t('ov.owed'), value: f.money(data.figures.owedCents), note: t('ov.owedNote') },
          ...(data.showMoney ? [{
            label: t('ov.profit'),
            value: <span className={(data.figures.profitCents ?? 0) < 0 ? 'neg' : undefined}>{f.money(data.figures.profitCents)}</span>,
            note: pct == null ? undefined : pct === 0 ? t('ov.same') : t(pct > 0 ? 'ov.up' : 'ov.down', { pct: Math.abs(pct) }),
          }] : []),
        ]} />
      </Panel>

      <div className="grid-2" style={{ alignItems: 'start' }}>
        <Panel title={t('ov.byDay')} id="by-day">
          <div className="panel-body">
            <div className="bars" aria-hidden="true">
              {data.perDay.map((d) => (
                <div key={d.date} className="bar-col">
                  <span className="num bar-label">{d.hovership ? f.number(d.hovership) : ''}</span>
                  <span className="bar" style={{ height: `${Math.round((d.hovership / max) * 150)}px` }} />
                  <span className="bar-day">{f.date(d.date, { weekday: 'short' })}</span>
                </div>
              ))}
            </div>
            <p className="legend"><span className="swatch" aria-hidden="true" />Hovership</p>
            <table className="visually-hidden">
              <caption>{t('ov.byDayCaption')}</caption>
              <thead><tr><th scope="col">{t('ov.day')}</th><th scope="col">Hovership</th></tr></thead>
              <tbody>{data.perDay.map((d) => <tr key={d.date}><th scope="row">{f.date(d.date, { weekday: 'long', month: 'long', day: 'numeric' })}</th><td>{d.hovership}</td></tr>)}</tbody>
            </table>
          </div>
        </Panel>
        <Panel title={t('ov.eachOp')} id="ops">
          <div className="op-block">
            <div className="row" style={{ justifyContent: 'space-between' }}><strong>Hovership</strong><span className="muted">{t('ov.biweekly')}</span></div>
            <dl className="op-figures">
              {data.showMoney && <div><dt>{t('ov.revenue')}</dt><dd className="num">{f.money(data.hovership.revenueCents)}</dd></div>}
              <div><dt>{t('ov.driversCost')}</dt><dd className="num">{f.money(data.hovership.driversCents)}</dd></div>
              {data.showMoney && <div><dt>{t('hs.profit')}</dt><dd className="num">{f.money(data.hovership.profitCents)}</dd></div>}
            </dl>
            <p className="muted" style={{ margin: 0, fontSize: 13.5 }}>{t('ov.hovershipTerms')}</p>
          </div>
          <div className="op-block">
            <div className="row" style={{ justifyContent: 'space-between' }}><strong>T-Force</strong><span className="muted">{t('ov.weekly')}</span></div>
            <p className="muted" style={{ margin: 0, fontSize: 13.5 }}>{t('ov.tforceLater')} {t('ov.tforceTerms')}</p>
          </div>
        </Panel>
      </div>
    </>
  );
}

function Need({ item }: { item: NeedItem }) {
  const t = useT();
  const f = useFormat();
  let title: ReactNode, body: ReactNode, action: ReactNode;
  switch (item.kind) {
    case 'unknown_codes':
      title = t('ov.unknownCodes', { count: item.count });
      body = t('ov.unknownCodesBody');
      action = <Link className={buttonClass('primary', 'sm')} to="/hovership/week/$weekId" params={{ weekId: item.week }}>{t('ov.review')}</Link>;
      break;
    case 'missing_rates':
      title = t('ov.missingRates', { count: item.count });
      body = t('ov.missingRatesBody');
      action = <Link className={buttonClass('primary', 'sm')} to="/settings/rates">{t('ov.addRate')}</Link>;
      break;
    case 'run_ready':
      title = t('ov.runReady', { range: rangeText(item, t, f) });
      body = t('ov.runReadyBody', { amount: f.money(item.payCents) });
      action = <Link className={buttonClass('primary', 'sm')} to="/payroll/$runId" params={{ runId: item.runId }}>{t('ov.review')}</Link>;
      break;
    case 'run_blocked': {
      title = t('ov.runBlocked', { range: rangeText(item, t, f) });
      const [kind, weeks] = item.reason.split(':');
      body = kind === 'missing_report'
        ? t('pay.blocker.missing_report', { weeks: (weeks ?? '').split(',').map((w) => f.date(w, { month: 'long', day: 'numeric' })).join(', ') })
        : t(`pay.blocker.${kind}` as MessageKey, { count: '' });
      action = <Link className={buttonClass('secondary', 'sm')} to="/payroll/$runId" params={{ runId: item.runId }}>{t('ov.open')}</Link>;
      break;
    }
    case 'lost_day':
      title = t('ov.lostDay', { name: item.name });
      body = t('ov.lostDayBody', { bonus: f.money(item.bonusCents), packages: item.packages, margin: f.money(item.marginCents), count: item.count });
      action = <Link className={buttonClass('secondary', 'sm')} to="/hovership/week/$weekId" params={{ weekId: item.week }}>{t('ov.seeDay')}</Link>;
      break;
  }
  return (
    <li className="todo">
      <WarningDiamond />
      <div style={{ flex: 1, minWidth: 0 }}><strong>{title}</strong><span className="sub" style={{ fontSize: 14 }}>{body}</span></div>
      {action}
    </li>
  );
}

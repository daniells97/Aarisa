import { Link, createFileRoute } from '@tanstack/react-router';
import { useT } from '~/i18n';
import { getRuns } from '~/server/payroll-fns';
import { PageHead, Panel, Pill, WarningDiamond, useFormat } from '~/ui';
import { blockerText, rangeText, statusTone } from '~/ui/payroll-text';

export const Route = createFileRoute('/_app/payroll/')({
  loader: () => getRuns(),
  component: PayrollList,
});

function PayrollList() {
  const t = useT();
  const f = useFormat();
  const { runs } = Route.useLoaderData();
  const open = runs.filter((r) => r.status !== 'approved' && r.status !== 'paid');
  const closed = runs.filter((r) => r.status === 'approved' || r.status === 'paid');
  const list = (items: typeof runs) => items.length === 0 ? <p className="panel-body muted" style={{ margin: 0 }}>{t('pay.none')}</p> : (
    <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
      {items.map((r) => {
        const range = rangeText(r.period, t, f);
        return (
          <li key={r.runId} className="run-row">
            <div style={{ flex: 1, minWidth: 200 }}>
              <Link to="/payroll/$runId" params={{ runId: r.runId }} aria-label={t('pay.open.run', { range })} className="run-link">
                <strong>Hovership</strong> <span className="muted">{range}</span>
              </Link>
              {r.blockers.length > 0 && r.status === 'draft' && (
                <span className="sub row" style={{ gap: 6 }}><WarningDiamond size={16} />{blockerText(r.blockers[0]!, t, f)}</span>
              )}
              {r.paidAt && <span className="sub">{t('pay.paidOn', { date: f.dateTime(r.paidAt) })}</span>}
            </div>
            <Pill tone={statusTone[r.status]}>{t(`pay.status.${r.status}`)}</Pill>
            <span className="num" style={{ minWidth: 110, textAlign: 'right', fontWeight: 600 }}>{f.money(r.payCents)}</span>
          </li>
        );
      })}
    </ul>
  );
  return (
    <>
      <PageHead title={t('pay.title')} lead={t('pay.lead')} />
      <Panel title={t('pay.open')} id="open">
        {list(open)}
        <p className="panel-body muted" style={{ margin: 0, paddingTop: 12, fontSize: 13.5 }}>{t('pay.tforceLater')}</p>
      </Panel>
      <Panel title={t('pay.closed')} id="closed">{list(closed)}</Panel>
    </>
  );
}

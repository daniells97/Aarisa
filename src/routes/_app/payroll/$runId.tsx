import { useState } from 'react';
import { createFileRoute, useRouter } from '@tanstack/react-router';
import { useT, type MessageKey } from '~/i18n';
import { approve, getRun, markPaid, reopen } from '~/server/payroll-fns';
import { Button, Dialog, Figures, Icon, PageHead, Panel, Pill, WarningDiamond, buttonClass, useFormat, useToast } from '~/ui';
import { blockerText, opName, rangeText, statusTone } from '~/ui/payroll-text';

type Run = Awaited<ReturnType<typeof getRun>>;

export const Route = createFileRoute('/_app/payroll/$runId')({
  loader: ({ params }) => getRun({ data: { runId: params.runId } }),
  component: RunPage,
});

function RunPage() {
  const t = useT();
  const f = useFormat();
  const run = Route.useLoaderData();
  const router = useRouter();
  const toast = useToast();
  const [approving, setApproving] = useState(false);
  const range = rangeText(run.period, t, f);
  const tforce = run.operation === 'tforce';
  // Without a rate the amounts are unknown, not zero.
  const noRate = run.blockers.some((b) => b.kind === 'missing_rates');
  const money = (c: number | null) => (noRate ? '–' : f.money(c));
  const frozen = run.status === 'approved' || run.status === 'paid';

  const act = async (fn: () => Promise<{ ok: true } | { ok: false; code: string }>, okMessage: MessageKey) => {
    const res = await fn();
    if (!res.ok) return toast(t(`error.${res.code}` as MessageKey));
    toast(t(okMessage));
    await router.invalidate();
  };

  const approveReason = !run.canApprove && (run.status === 'draft' || run.status === 'ready' || run.status === 'reopened')
    ? (run.blockers.length ? t('pay.notReadyReason', { reason: run.blockers.map((b) => blockerText(b, t, f)).join('; ') }) : t('pay.ownerOnly'))
    : undefined;

  return (
    <>
      <PageHead
        title={t('pay.runTitle', { operation: opName(run.operation), range })}
        lead={<span className="row" style={{ gap: 8 }}>
          <Pill tone={statusTone[run.status]}>{t(`pay.status.${run.status}`)}</Pill>
          {run.approvedAt && <span>{t('pay.approvedOn', { when: f.dateTime(run.approvedAt), who: run.approvedBy ?? '' })}</span>}
        </span>}
        actions={
          <div className="row" style={{ alignItems: 'flex-start' }}>
            {run.canExport && (
              <a className={buttonClass()} href={`/payroll-export/${run.runId}`} download>
                <Icon name="download" width={18} height={18} />{t(frozen ? 'pay.export' : 'pay.exportDraft')}
              </a>
            )}
            {run.canReopen && <Button onClick={() => act(() => reopen({ data: { runId: run.runId } }), 'pay.reopened')}>{t('pay.reopen')}</Button>}
            {run.canMarkPaid && <Button onClick={() => act(() => markPaid({ data: { runId: run.runId } }), 'pay.markedPaid')}>{t('pay.markPaid')}</Button>}
            {!frozen && (
              <Button id="approve" variant="primary" onClick={() => setApproving(true)} disabledReason={approveReason}>
                {t('pay.review')}
              </Button>
            )}
          </div>
        }
      />
      {frozen && (
        <p className="notice notice-info" style={{ margin: 0 }}>
          {t('pay.lockedNote')} {run.canReopen && run.reopenableUntil && t('pay.reopenUntil', { when: f.dateTime(run.reopenableUntil) })}
        </p>
      )}
      {frozen && run.liveDiffersCents !== 0 && (
        <p className="notice" role="alert" style={{ margin: 0 }}><WarningDiamond size={22} />{t('pay.liveDiffers', { amount: f.money(run.liveDiffersCents) })}</p>
      )}
      {noRate && <p className="notice" style={{ margin: 0 }}><WarningDiamond size={22} />{t('pay.noRateNote')}</p>}
      <Panel>
        <Figures items={[
          { label: t('pay.drivers'), value: f.number(run.totals.drivers) },
          { label: t('pay.routeDays'), value: f.number(run.totals.routeDays) },
          { label: t(tforce ? 'pay.pieces' : 'pay.packages'), value: f.number(run.totals.packages) },
          ...(tforce ? [] : [{ label: t('pay.bonuses'), value: f.money(run.totals.bonusCents) }]),
          { label: t('pay.toPay'), value: money(run.totals.payCents), note: noRate ? t('pay.noRate') : undefined },
          ...(run.showMoney ? [{ label: t('pay.profit'), value: money(run.totals.profitCents) }] : []),
        ]} />
      </Panel>
      <Panel title={t('pay.drivers')} id="lines">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">{t('hs.driver')}</th><th scope="col" className="r">{t('pay.routeDays')}</th><th scope="col" className="r">{t(tforce ? 'pay.pieces' : 'pay.packages')}</th>
                {!tforce && <><th scope="col" className="r">{t('pay.stops')}</th><th scope="col" className="r">{t('pay.bonuses')}</th></>}<th scope="col" className="r">{t('pay.pay')}</th>
                {run.showMoney && <th scope="col" className="r">{t('pay.margin')}</th>}
              </tr>
            </thead>
            <tbody>
              {run.lines.map((l) => (
                <tr key={l.key}>
                  <td><strong>{l.name}</strong>{l.contractor ? <> <Pill tone="contractor">{t('pill.contractor')}</Pill></> : !tforce && <span className="sub">{l.code}</span>}</td>
                  <td className="r num">{l.routeDays}</td><td className="r num">{f.number(l.packages)}</td>
                  {!tforce && <><td className="r num">{l.stops}</td><td className="r num">{f.money(l.bonusCents)}</td></>}
                  <td className="r num"><strong>{money(l.payCents)}</strong></td>
                  {run.showMoney && <td className={`r num${(l.marginCents ?? 0) < 0 ? ' neg' : ''}`}>{money(l.marginCents)}</td>}
                </tr>
              ))}
              <tr className="total-row">
                <td>{t('hs.total')}</td><td className="r num">{run.totals.routeDays}</td><td className="r num">{f.number(run.totals.packages)}</td>
                {!tforce && <><td className="r num">{run.totals.stops}</td><td className="r num">{f.money(run.totals.bonusCents)}</td></>}<td className="r num">{money(run.totals.payCents)}</td>
                {run.showMoney && <td />}
              </tr>
            </tbody>
          </table>
        </div>
      </Panel>
      {approving && <ApproveDialog run={run} range={range} onClose={() => setApproving(false)} />}
    </>
  );
}

function ApproveDialog({ run, range, onClose }: { run: Run; range: string; onClose: () => void }) {
  const t = useT();
  const f = useFormat();
  const router = useRouter();
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const amount = f.money(run.totals.payCents);
  const submit = async () => {
    setBusy(true);
    try {
      const res = await approve({ data: { runId: run.runId, expectedPayCents: run.totals.payCents } });
      if (!res.ok) { setError(t(`error.${res.code}` as MessageKey)); await router.invalidate(); return; }
      toast(t('ap.approved', { amount }));
      onClose();
      await router.invalidate();
    } catch {
      setError(t('error.generic'));
    } finally {
      setBusy(false);
    }
  };
  const w = run.warnings;
  return (
    <Dialog open onClose={onClose} title={t('ap.title')}
      footer={<>
        <Button onClick={onClose}>{t('ap.goBack')}</Button>
        <Button variant="primary" onClick={submit} disabled={busy}>{t('ap.approve', { amount })}</Button>
      </>}>
      <p className="muted" style={{ margin: 0 }}>{t('pay.runTitle', { operation: opName(run.operation), range })}</p>
      <div className="big-figures">
        <div><div className="figure-label">{t('ap.driversPaid')}</div><div className="figure-value">{run.totals.drivers}</div></div>
        <div><div className="figure-label">{t('ap.bonusesIncluded')}</div><div className="figure-value">{f.money(run.totals.bonusCents)}</div></div>
        <div><div className="figure-label">{t('ap.totalToPay')}</div><div className="figure-value">{amount}</div></div>
      </div>
      <section aria-labelledby="checks-h" className="stack" style={{ gap: 8 }}>
        <h3 id="checks-h" style={{ fontSize: 20 }}>{t('ap.checks')}</h3>
        <ul className="checks">
          {run.weeks.map((wk) => <li key={wk.start}><span className="check-ok" aria-hidden="true">✓</span>{t('pay.weekRead', { date: f.date(wk.start, { month: 'long', day: 'numeric' }) })}</li>)}
          <li><span className="check-ok" aria-hidden="true">✓</span>{t(run.operation === 'tforce' ? 'ap.checkExceptions' : 'ap.checkCodes')}</li>
          <li><span className="check-ok" aria-hidden="true">✓</span>{t('ap.checkRates')}</li>
        </ul>
      </section>
      <section aria-labelledby="worth-h" className="stack" style={{ gap: 8 }}>
        <h3 id="worth-h" style={{ fontSize: 20 }}>{t('ap.worth')}</h3>
        <ul className="checks">
          {w.newDrivers.length > 0 && <li><WarningDiamond size={20} />{t('ap.newDrivers', { names: w.newDrivers.join(', ') })}</li>}
          {w.negativeDays.slice(0, 3).map((d) => (
            <li key={`${d.name}-${d.date}`}><WarningDiamond size={20} />{t('ap.negative', { name: d.name, date: f.date(d.date, { month: 'short', day: 'numeric' }), amount: f.money(d.marginCents) })}</li>
          ))}
          {w.negativeDayCount > 3 && <li><WarningDiamond size={20} />{t('ap.moreNegative', { count: w.negativeDayCount })}</li>}
          {w.newDrivers.length === 0 && w.negativeDayCount === 0 && <li className="muted">{t('ap.nothing')}</li>}
        </ul>
      </section>
      <p className="notice notice-info" style={{ margin: 0 }}>{t('ap.what')}</p>
      {error && <p role="alert" className="field-error" style={{ margin: 0 }}>{error}</p>}
    </Dialog>
  );
}

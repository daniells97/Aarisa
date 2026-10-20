import { useState } from 'react';
import { useRouter } from '@tanstack/react-router';
import { useT, type MessageKey } from '~/i18n';
import type { getTforceWeek } from '~/server/tforce-fns';
import { resolveException } from '~/server/tforce-fns';
import { Button } from './Button';
import { RoutePlate } from './RoutePlate';
import { WarningDiamond } from './WarningDiamond';
import { useFormat } from './format';
import { useToast } from './Toast';

type Week = Awaited<ReturnType<typeof getTforceWeek>>;
type Ex = Week['exceptions'][number];

/** One open exception with the resolutions spec §5.3 allows for its type. Used on desktop and phone. */
export function ExceptionCard({ ex, week }: { ex: Ex; week: Week }) {
  const t = useT();
  const f = useFormat();
  const router = useRouter();
  const toast = useToast();
  const [assigning, setAssigning] = useState(false);
  const [payee, setPayee] = useState('');
  const [busy, setBusy] = useState(false);
  const day = f.date(ex.date, { weekday: 'long' });
  const dayShort = f.date(ex.date, { weekday: 'short', month: 'short', day: 'numeric' });

  const resolve = async (resolution: Parameters<typeof resolveException>[0]['data']['resolution'], what: MessageKey) => {
    setBusy(true);
    try {
      const res = await resolveException({ data: { exceptionId: ex.id, resolution } });
      if (!res.ok) return toast(t(`error.${res.code}` as MessageKey));
      toast(t('wk.cleared', { route: ex.route, day: dayShort, what: t(what) }));
      await router.invalidate();
    } finally {
      setBusy(false);
    }
  };

  let title: string, body: string;
  switch (ex.type) {
    case 'unknown_name':
      title = t('wk.ex.unknown_name', { day }); body = t('wk.ex.unknown_name.body', { pieces: ex.pieces ?? 0, name: ex.rawName ?? '' }); break;
    case 'no_driver':
      title = t('wk.ex.no_driver', { day }); body = t('wk.ex.no_driver.body', { pieces: ex.pieces ?? 0 }); break;
    case 'low_pieces': {
      title = ex.pieces === 1 ? t('wk.ex.low_pieces.one', { day }) : t('wk.ex.low_pieces', { day, pieces: ex.pieces ?? 0 });
      const parts = [];
      if (ex.payee) parts.push(t('wk.ex.low_pieces.body', { driver: ex.payee, low: ex.low ?? '–', high: ex.high ?? '–' }));
      if (ex.dayBefore != null && ex.dayAfter != null) parts.push(t('wk.ex.low_pieces.bodyNeighbours', { before: ex.dayBefore, after: ex.dayAfter }));
      body = parts.join(' ');
      break;
    }
    default:
      title = t('wk.ex.no_pieces', { day }); body = t('wk.ex.no_pieces.body', { driver: ex.payee ?? '' });
  }

  const can = week.canResolve;
  return (
    <li className="ex-card">
      <div className="row" style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}>
        <WarningDiamond size={24} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="row" style={{ gap: 8 }}><RoutePlate code={ex.route} needsDriver={ex.type === 'unknown_name' || ex.type === 'no_driver'} /><strong>{title}</strong></div>
          <p style={{ margin: '6px 0 0', color: 'var(--ink-3)' }}>{body}</p>
        </div>
      </div>
      {can && !assigning && (
        <div className="row ex-actions">
          {(ex.type === 'unknown_name' || ex.type === 'no_driver') && <>
            <Button variant="primary" onClick={() => setAssigning(true)}>{t('wk.assign')}</Button>
            <Button disabled={busy} onClick={() => resolve({ action: 'not_ours' }, 'wk.resolved.not_ours')}>{t('wk.notOurs')}</Button>
          </>}
          {ex.type === 'low_pieces' && <>
            <Button disabled={busy} onClick={() => resolve({ action: 'pay_as_reported' }, 'wk.resolved.pay_as_reported')}>{t('wk.payAsReported')}</Button>
            <Button disabled={busy} onClick={() => resolve({ action: 'ask_client' }, 'wk.resolved.ask_client')}>{t('wk.askClient')}</Button>
          </>}
          {ex.type === 'no_pieces' && <>
            <Button disabled={busy} onClick={() => resolve({ action: 'ask_client' }, 'wk.resolved.ask_client')}>{t('wk.askClient')}</Button>
            <Button disabled={busy} onClick={() => resolve({ action: 'not_ours' }, 'wk.resolved.not_ours')}>{t('wk.notOurs')}</Button>
          </>}
        </div>
      )}
      {assigning && (
        <form className="row ex-actions" style={{ alignItems: 'flex-end' }} onSubmit={(e) => {
          e.preventDefault();
          if (!payee) return;
          const p = payee.startsWith('c:') ? { contractorId: payee.slice(2) } : { driverId: payee.slice(2) };
          void resolve({ action: 'assign', payee: p }, 'wk.resolved.assigned_driver');
        }}>
          <div className="field" style={{ flex: '1 1 220px' }}>
            <label htmlFor={`assign-${ex.id}`}>{t('wk.driverFor', { route: ex.route, day: dayShort })}</label>
            <select id={`assign-${ex.id}`} className="input" required value={payee} onChange={(e) => setPayee(e.target.value)}>
              <option value="" />
              <optgroup label={t('td.groupContractors')}>{week.options.contractors.map((c) => <option key={c.id} value={`c:${c.id}`}>{c.name}</option>)}</optgroup>
              <optgroup label={t('td.groupDrivers')}>{week.options.drivers.map((d) => <option key={d.id} value={`d:${d.id}`}>{d.name}</option>)}</optgroup>
            </select>
          </div>
          <Button type="submit" variant="primary" disabled={busy || !payee}>{t('wk.saveAssign')}</Button>
          <Button onClick={() => setAssigning(false)}>{t('common.cancel')}</Button>
        </form>
      )}
    </li>
  );
}

export function ResolvedList({ items }: { items: Ex[] }) {
  const t = useT();
  const f = useFormat();
  if (!items.length) return null;
  return (
    <details className="resolved">
      <summary>{t('wk.resolvedTitle')} ({items.length})</summary>
      <ul>
        {items.map((e) => (
          <li key={e.id}><RoutePlate code={e.route} size="sm" /> {f.date(e.date, { weekday: 'short', month: 'short', day: 'numeric' })}: {e.resolution ? t(`wk.resolved.${e.resolution}` as MessageKey) : ''}</li>
        ))}
      </ul>
    </details>
  );
}

import { useState } from 'react';
import { useRouter } from '@tanstack/react-router';
import { useT, type MessageKey } from '~/i18n';
import type { getTforceWeek } from '~/server/tforce-fns';
import { resolveException } from '~/server/tforce-fns';
import { Button } from './Button';
import { RoutePlate } from './RoutePlate';
import { WarningDiamond } from './WarningDiamond';
import { useFormat } from './format';
import { CheckField, TextField } from './Field';
import { toCents } from '~/domain/money';
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
  const [piecesForm, setPiecesForm] = useState<'pay_other' | 'ask_client' | null>(null);
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
      {can && !assigning && !piecesForm && (
        <div className="row ex-actions">
          {(ex.type === 'unknown_name' || ex.type === 'no_driver') && <>
            <Button variant="primary" onClick={() => setAssigning(true)}>{t('wk.assign')}</Button>
            <Button disabled={busy} onClick={() => resolve({ action: 'not_ours' }, 'wk.resolved.not_ours')}>{t('wk.notOurs')}</Button>
          </>}
          {ex.type === 'low_pieces' && <Button disabled={busy} onClick={() => resolve({ action: 'pay_as_reported' }, 'wk.resolved.pay_as_reported')}>{t('wk.payAsReported')}</Button>}
          {(ex.type === 'low_pieces' || ex.type === 'no_pieces') && <>
            {week.canPayOther && ex.basis?.hasPayee && <Button disabled={busy} onClick={() => setPiecesForm('pay_other')}>{t('wk.payOther')}</Button>}
            <Button disabled={busy} onClick={() => setPiecesForm('ask_client')}>{t('wk.askClient')}</Button>
          </>}
          {ex.type === 'no_pieces' && <Button disabled={busy} onClick={() => resolve({ action: 'not_ours' }, 'wk.resolved.not_ours')}>{t('wk.notOurs')}</Button>}
        </div>
      )}
      {piecesForm && ex.basis && (
        <PiecesForm mode={piecesForm} client={week.operation.name} showMoney={week.showMoney} ex={ex} basis={ex.basis} canPayOther={week.canPayOther} busy={busy} onCancel={() => setPiecesForm(null)}
          onSubmit={(r) => resolve(r, r.action === 'pay_other' ? 'wk.resolved.pay_other' : 'wk.resolved.ask_client')} />
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

type Resolution = Parameters<typeof resolveException>[0]['data']['resolution'];

/**
 * What the payee is paid for the day, and for "Ask T-Force" what is claimed. Nothing is preset for the
 * payee: the owner decides (a dispatcher can only keep what the client reported).
 */
function PiecesForm({ mode, client, showMoney, ex, basis, canPayOther, busy, onCancel, onSubmit }: {
  mode: 'pay_other' | 'ask_client'; client: string; showMoney: boolean; ex: Ex; basis: NonNullable<Ex['basis']>; canPayOther: boolean; busy: boolean;
  onCancel: () => void; onSubmit: (r: Resolution) => void;
}) {
  const t = useT();
  const f = useFormat();
  const [pay, setPay] = useState<'reported' | 'other' | null>(mode === 'pay_other' ? 'other' : canPayOther && basis.hasPayee ? null : 'reported');
  const [payQty, setPayQty] = useState('');
  const [claimQty, setClaimQty] = useState(String(basis.suggestedQuantity || ''));
  const [amount, setAmount] = useState(basis.clientRateCents != null && basis.suggestedQuantity ? ((basis.suggestedQuantity * basis.clientRateCents) / 100).toFixed(2) : '');
  const [amountTouched, setAmountTouched] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const id = `pf-${ex.id}`;
  const pieces = (n: number) => (n === 1 ? t('wk.pf.onePiece') : t('wk.pf.nPieces', { n }));
  const payQuantity = pay === 'reported' ? basis.reported : Number(payQty);
  const payDiff = pay === 'other' && payQty !== '' && basis.payeeRateCents != null ? (Number(payQty) - basis.reported) * basis.payeeRateCents : null;

  const changeClaimQty = (v: string) => {
    setClaimQty(v);
    if (!amountTouched && basis.clientRateCents != null && /^\d+$/.test(v)) setAmount(((Number(v) * basis.clientRateCents) / 100).toFixed(2));
  };
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!pay) return setError(t('wk.pf.choosePay'));
    if (pay === 'other' && !/^\d+$/.test(payQty)) return setError(t('wk.pf.payQtyRequired'));
    if (mode === 'pay_other') return onSubmit({ action: 'pay_other', payQuantity });
    if (!/^\d+$/.test(claimQty) || Number(claimQty) <= 0) return setError(t('wk.pf.claimQtyRequired'));
    let claimCents: number | null = null;
    if (showMoney) {
      try { claimCents = toCents(amount); } catch { return setError(t('error.invalid_amount')); }
      if (claimCents <= 0) return setError(t('error.invalid_amount'));
    }
    onSubmit({ action: 'ask_client', claimQuantity: Number(claimQty), claimCents, payQuantity, note: note.trim() || null });
  };

  return (
    <form className="stack ex-actions pieces-form" onSubmit={submit} aria-labelledby={`${id}-title`}>
      <strong id={`${id}-title`}>{t(mode === 'pay_other' ? 'wk.payOther' : 'wk.askClient')}</strong>
      <p className="muted" style={{ margin: 0 }}>{t('wk.pf.facts', { client, reported: pieces(basis.reported), usual: basis.usual })}</p>
      {mode === 'ask_client' && <>
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <TextField label={t('wk.pf.claimQty')} inputMode="numeric" required value={claimQty} onChange={(e) => changeClaimQty(e.target.value.replace(/\D/g, ''))}
            hint={basis.suggestedQuantity ? t('wk.pf.claimQtyHint', { n: basis.suggestedQuantity }) : undefined} />
          {showMoney && (
            <TextField label={t('wk.pf.claimAmount')} inputMode="decimal" required value={amount} onChange={(e) => { setAmount(e.target.value); setAmountTouched(true); }}
              hint={basis.clientRateCents != null ? t('wk.pf.claimAmountHint', { rate: f.money(basis.clientRateCents) }) : t('wk.pf.claimAmountNoRate')} />
          )}
        </div>
        <TextField label={t('wk.pf.note')} value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} hint={t('wk.pf.noteHint')} />
      </>}
      {mode === 'ask_client' && (
        <fieldset className="stack" style={{ gap: 8, border: 0, padding: 0, margin: 0 }}>
          <legend style={{ fontWeight: 500, marginBottom: 6 }}>{t('wk.pf.payLegend', { driver: ex.payee ?? '' })}</legend>
          <CheckField type="radio" name={`${id}-pay`} checked={pay === 'reported'} onChange={() => setPay('reported')} label={t('wk.pf.payReported', { n: pieces(basis.reported) })} />
          {canPayOther && basis.hasPayee && <CheckField type="radio" name={`${id}-pay`} checked={pay === 'other'} onChange={() => setPay('other')} label={t('wk.pf.payOtherChoice')} />}
          {!canPayOther && <span className="muted" style={{ fontSize: 13.5 }}>{t('wk.pf.ownerDecides')}</span>}
        </fieldset>
      )}
      {pay === 'other' && (
        <TextField label={t('wk.pf.payQty', { driver: ex.payee ?? '' })} inputMode="numeric" required value={payQty} onChange={(e) => setPayQty(e.target.value.replace(/\D/g, ''))}
          hint={payDiff != null ? t(payDiff >= 0 ? 'wk.pf.payMore' : 'wk.pf.payLess', { amount: f.money(Math.abs(payDiff)) }) : t('wk.pf.payQtyHint')} />
      )}
      {error && <p role="alert" className="field-error" style={{ margin: 0 }}>{error}</p>}
      <div className="row">
        <Button type="submit" variant="primary" disabled={busy}>{t(mode === 'pay_other' ? 'wk.pf.savePay' : 'wk.pf.saveClaim')}</Button>
        <Button onClick={onCancel}>{t('common.cancel')}</Button>
      </div>
    </form>
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

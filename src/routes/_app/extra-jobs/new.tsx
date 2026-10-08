import { useMemo, useState } from 'react';
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router';
import { z } from 'zod';
import { useT, type MessageKey } from '~/i18n';
import { todayLA } from '~/domain/dates';
import { getExtraJobOptions, saveExtraJob } from '~/server/extra-jobs-fns';
import { Button, FormError, Icon, PageHead, Panel, SelectField, TextField, parseAmount, useToast } from '~/ui';

export const Route = createFileRoute('/_app/extra-jobs/new')({
  validateSearch: z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }),
  loader: () => getExtraJobOptions(),
  component: NewExtraJob,
});

function NewExtraJob() {
  const t = useT();
  const options = Route.useLoaderData();
  const { date: initialDate } = Route.useSearch();
  const navigate = useNavigate();
  const toast = useToast();
  // Made once per form: a double tap or a resend after a dropped connection can't create two jobs.
  const clientUuid = useMemo(() => crypto.randomUUID(), []);
  const [service, setService] = useState(options.services[0]?.code ?? 'recovery_route');
  const [date, setDate] = useState(initialDate ?? todayLA());
  const [nearRouteId, setNearRoute] = useState('');
  const [payee, setPayee] = useState('');
  const [clientAmount, setClientAmount] = useState('');
  const [driverAmount, setDriverAmount] = useState('');
  const [orderNumber, setOrderNumber] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const svc = options.services.find((s) => s.code === service);
  const payeeName = payee.startsWith('c:') ? options.contractors.find((c) => c.id === payee.slice(2))?.name : payee.startsWith('d:') ? options.drivers.find((d) => d.id === payee.slice(2))?.name : null;
  const clientCents = parseAmount(clientAmount);
  const driverCents = parseAmount(driverAmount);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!payee) return setError(t('error.payee_required'));
    if (driverCents == null) return setError(driverCents === undefined ? t('error.invalid_amount') : t('error.driver_amount_required'));
    if (clientCents === undefined) return setError(t('error.invalid_amount'));
    setBusy(true);
    try {
      const res = await saveExtraJob({ data: {
        clientUuid, service, date, nearRouteId: nearRouteId || null,
        payee: payee.startsWith('c:') ? { contractorId: payee.slice(2) } : { driverId: payee.slice(2) },
        clientAmountCents: options.showMoney ? clientCents : null, driverAmountCents: driverCents,
        orderNumber: orderNumber || null, note: note || null,
      } });
      if (!res.ok) return setError(t(`error.${res.code}` as MessageKey));
      toast(t(res.value.created ? 'xj.savedToast' : 'xj.alreadySaved'));
      await navigate({ to: '/extra-jobs', search: { date } });
    } catch {
      setError(t('error.generic'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHead title={t('xj.formTitle')} actions={<Link to="/extra-jobs" search={{ date }} className="close-btn" aria-label={t('common.close')}><Icon name="close" width={20} height={20} /></Link>} />
      <Panel>
        <form className="panel-body stack xj-form" style={{ paddingTop: 20 }} onSubmit={submit}>
          <fieldset className="svc-toggles">
            <legend>{t('xj.service')}</legend>
            {options.services.map((s) => (
              <button key={s.code} type="button" aria-pressed={service === s.code} onClick={() => setService(s.code)}>{t(`xj.svc.${s.code}` as MessageKey)}</button>
            ))}
          </fieldset>
          <div className="grid-2">
            <TextField label={t('xj.date')} type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
            <SelectField label={t('xj.nearRoute')} value={nearRouteId} onChange={(e) => setNearRoute(e.target.value)}>
              <option value="">{t('xj.noRoute')}</option>
              {options.routes.map((r) => <option key={r.id} value={r.id}>{r.code}</option>)}
            </SelectField>
          </div>
          <SelectField label={t('xj.doneBy')} required value={payee} onChange={(e) => setPayee(e.target.value)}>
            <option value="">{t('xj.choose')}</option>
            <optgroup label={t('td.groupContractors')}>{options.contractors.map((c) => <option key={c.id} value={`c:${c.id}`}>{c.name}</option>)}</optgroup>
            <optgroup label={t('td.groupDrivers')}>{options.drivers.map((d) => <option key={d.id} value={`d:${d.id}`}>{d.name}</option>)}</optgroup>
          </SelectField>
          <div className="grid-2">
            {options.showMoney && (
              <TextField label={t('xj.clientPays')} inputMode="decimal" value={clientAmount} onChange={(e) => setClientAmount(e.target.value)}
                hint={t('rates.leaveBlank')} error={clientCents === undefined ? t('error.invalid_amount') : undefined} />
            )}
            <TextField label={payeeName ? t('xj.payeeGets', { who: payeeName }) : t('xj.driverGets')} inputMode="decimal" required value={driverAmount}
              onChange={(e) => setDriverAmount(e.target.value)} error={driverCents === undefined ? t('error.invalid_amount') : undefined} />
          </div>
          {!options.showMoney && <p className="muted" style={{ margin: 0, fontSize: 13.5 }}>{t('xj.clientHidden')}</p>}
          <TextField label={t('xj.orderNumber')} required={svc?.requiresOrderNumber} value={orderNumber} onChange={(e) => setOrderNumber(e.target.value)}
            hint={svc?.requiresOrderNumber ? `${t('xj.orderRequired')} ${t('xj.orderHint')}` : t('xj.orderHint')} autoComplete="off" />
          <TextField label={t('xj.note')} required={svc?.requiresNote} value={note} onChange={(e) => setNote(e.target.value)} hint={t('xj.noteHint')} />
          <FormError>{error}</FormError>
          <Button type="submit" variant="primary" size="lg" disabled={busy} style={{ width: '100%' }}>{t('xj.save')}</Button>
        </form>
      </Panel>
    </>
  );
}

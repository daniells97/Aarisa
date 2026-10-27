import { useMemo, useState } from 'react';
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router';
import { z } from 'zod';
import { useLocale, useT, type MessageKey } from '~/i18n';
import { serviceLabel } from '~/ui/service-label';
import { todayLA } from '~/domain/dates';
import { getExtraJobDraft, getExtraJobOptions, saveExtraJob } from '~/server/extra-jobs-fns';
import { Button, FormError, Icon, PageHead, Panel, SelectField, TextField, WarningDiamond, centsToInput, parseAmount, useToast } from '~/ui';

export const Route = createFileRoute('/_app/extra-jobs/new')({
  validateSearch: z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), draft: z.string().optional() }),
  loaderDeps: ({ search }) => ({ draft: search.draft }),
  loader: async ({ deps }) => ({
    options: await getExtraJobOptions(),
    draft: deps.draft ? await getExtraJobDraft({ data: { token: deps.draft } }) : null,
  }),
  component: NewExtraJob,
});

function NewExtraJob() {
  const t = useT();
  const locale = useLocale();
  const { options, draft: draftRes } = Route.useLoaderData();
  const { date: initialDate } = Route.useSearch();
  const draft = draftRes?.ok ? draftRes.value : null;
  const ai = draft?.fields;
  // Fields the AI filled in are tinted green until the person changes them (design 6.6).
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const aiClass = (field: keyof NonNullable<typeof ai>) => (ai && ai[field] != null && !touched.has(field) ? 'input-ai' : undefined);
  const touch = (field: string) => setTouched((s) => (s.has(field) ? s : new Set(s).add(field)));
  const navigate = useNavigate();
  const toast = useToast();
  // Made once per form: a double tap or a resend after a dropped connection can't create two jobs.
  const clientUuid = useMemo(() => crypto.randomUUID(), []);
  const [service, setService] = useState(ai?.service ?? options.services[0]?.code ?? 'recovery_route');
  const [date, setDate] = useState(ai?.date ?? initialDate ?? todayLA());
  const [nearRouteId, setNearRoute] = useState(ai?.nearRouteId ?? '');
  const [payee, setPayee] = useState(ai?.payee ?? '');
  const defaults = (code: string) => options.services.find((x) => x.code === code);
  const [clientAmount, setClientAmount] = useState(centsToInput(ai?.clientAmountCents ?? defaults(ai?.service ?? options.services[0]?.code ?? '')?.defaultClientCents));
  const [driverAmount, setDriverAmount] = useState(centsToInput(ai?.driverAmountCents ?? defaults(ai?.service ?? options.services[0]?.code ?? '')?.defaultDriverCents));
  // Picking a service fills its default amounts, but never over an amount someone typed or the AI read.
  const pickService = (code: string) => {
    const prev = defaults(service);
    const next = defaults(code);
    setService(code);
    if (!touched.has('clientAmountCents') && ai?.clientAmountCents == null && (clientAmount === '' || clientAmount === centsToInput(prev?.defaultClientCents))) setClientAmount(centsToInput(next?.defaultClientCents));
    if (!touched.has('driverAmountCents') && ai?.driverAmountCents == null && (driverAmount === '' || driverAmount === centsToInput(prev?.defaultDriverCents))) setDriverAmount(centsToInput(next?.defaultDriverCents));
  };
  const [orderNumber, setOrderNumber] = useState(ai?.orderNumber ?? '');
  const [note, setNote] = useState(ai?.note ?? '');
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
        orderNumber: orderNumber || null, note: note || null, aiSuggestionId: draft?.suggestionId ?? null,
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
      {draftRes && !draftRes.ok && <p className="notice" role="alert" style={{ margin: 0 }}><WarningDiamond size={22} />{t(`error.${draftRes.code}` as MessageKey)}</p>}
      {draft && (
        <p className="notice notice-ai" style={{ margin: 0 }}>
          {t(draft.fromVoice ? 'xj.fromVoice' : 'xj.fromText', { time: new Intl.DateTimeFormat(undefined, { timeZone: 'America/Los_Angeles', hour: 'numeric', minute: '2-digit' }).format(new Date(draft.at)) })}
        </p>
      )}
      <Panel>
        <form className="panel-body stack xj-form" style={{ paddingTop: 20 }} onSubmit={submit}>
          <fieldset className="svc-toggles">
            <legend>{t('xj.service')}</legend>
            {options.services.map((s) => (
              <button key={s.code} type="button" aria-pressed={service === s.code} className={service === s.code && aiClass('service') ? 'ai-picked' : undefined} onClick={() => { pickService(s.code); touch('service'); }}>{serviceLabel(s, locale)}</button>
            ))}
          </fieldset>
          <div className="grid-2">
            <TextField label={t('xj.date')} type="date" required className={aiClass('date')} value={date} onChange={(e) => { setDate(e.target.value); touch('date'); }} />
            <SelectField label={t('xj.nearRoute')} className={aiClass('nearRouteId')} value={nearRouteId} onChange={(e) => { setNearRoute(e.target.value); touch('nearRouteId'); }}>
              <option value="">{t('xj.noRoute')}</option>
              {options.routes.map((r) => <option key={r.id} value={r.id}>{r.code}</option>)}
            </SelectField>
          </div>
          <SelectField label={t('xj.doneBy')} required className={aiClass('payee')} value={payee} onChange={(e) => { setPayee(e.target.value); touch('payee'); }}>
            <option value="">{t('xj.choose')}</option>
            <optgroup label={t('td.groupContractors')}>{options.contractors.map((c) => <option key={c.id} value={`c:${c.id}`}>{c.name}</option>)}</optgroup>
            <optgroup label={t('td.groupDrivers')}>{options.drivers.map((d) => <option key={d.id} value={`d:${d.id}`}>{d.name}</option>)}</optgroup>
          </SelectField>
          <div className="grid-2">
            {options.showMoney && (
              <TextField label={t('xj.clientPays')} inputMode="decimal" className={aiClass('clientAmountCents')} value={clientAmount} onChange={(e) => { setClientAmount(e.target.value); touch('clientAmountCents'); }}
                hint={t('rates.leaveBlank')} error={clientCents === undefined ? t('error.invalid_amount') : undefined} />
            )}
            <TextField label={payeeName ? t('xj.payeeGets', { who: payeeName }) : t('xj.driverGets')} inputMode="decimal" required className={aiClass('driverAmountCents')} value={driverAmount}
              onChange={(e) => { setDriverAmount(e.target.value); touch('driverAmountCents'); }} error={driverCents === undefined ? t('error.invalid_amount') : undefined} />
          </div>
          {!options.showMoney && <p className="muted" style={{ margin: 0, fontSize: 13.5 }}>{t('xj.clientHidden')}</p>}
          <TextField label={t('xj.orderNumber')} required={svc?.requiresOrderNumber} className={aiClass('orderNumber')} value={orderNumber} onChange={(e) => { setOrderNumber(e.target.value); touch('orderNumber'); }}
            hint={svc?.requiresOrderNumber ? `${t('xj.orderRequired')} ${t('xj.orderHint')}` : t('xj.orderHint')} autoComplete="off" />
          <TextField label={t('xj.note')} required={svc?.requiresNote} className={aiClass('note')} value={note} onChange={(e) => { setNote(e.target.value); touch('note'); }} hint={t('xj.noteHint')} />
          <FormError>{error}</FormError>
          <Button type="submit" variant="primary" size="lg" disabled={busy} style={{ width: '100%' }}>{t('xj.save')}</Button>
        </form>
      </Panel>
    </>
  );
}

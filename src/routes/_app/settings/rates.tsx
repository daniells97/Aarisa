import { useState } from 'react';
import { Link, createFileRoute, useRouter } from '@tanstack/react-router';
import { z } from 'zod';
import { useLocale, useT, type MessageKey } from '~/i18n';
import { serviceLabel } from '~/ui/service-label';
import { todayLA } from '~/domain/dates';
import { createContractor, createRate, createService, getSetup, saveDriver, saveService } from '~/server/setup-fns';
import {
  Button, CheckField, Dialog, FormError, PageHead, Panel, Pill, RoutePlate, SelectField, TextField,
  centsToInput, parseAmount, useFormat, useToast,
} from '~/ui';

type Setup = Awaited<ReturnType<typeof getSetup>>;
type Tab = 'rates' | 'drivers' | 'services';

export const Route = createFileRoute('/_app/settings/rates')({
  validateSearch: z.object({ tab: z.enum(['rates', 'drivers', 'services']).optional() }),
  loader: () => getSetup(),
  component: SetupPage,
});

function SetupPage() {
  const t = useT();
  const data = Route.useLoaderData();
  const tab: Tab = Route.useSearch().tab ?? 'rates';
  return (
    <>
      <PageHead title={t('setup.title')} lead={t('setup.lead')} />
      <nav className="tabs" aria-label={t('setup.sections')}>
        {(['rates', 'drivers', 'services'] as const).map((k) => (
          <Link key={k} to="/settings/rates" search={{ tab: k }} aria-current={tab === k ? 'page' : undefined}>{t(`setup.tab.${k}`)}</Link>
        ))}
      </nav>
      {tab === 'rates' && <RatesTab data={data} />}
      {tab === 'drivers' && <DriversTab data={data} />}
      {tab === 'services' && <ServicesTab data={data} />}
    </>
  );
}

// ---------------------------------------------------------------- rates

type Service = Setup['services'][number];
type RateRow = Setup['rates'][number];
type Tier = 't1_3' | 't4' | null;

/** One rate line per service (two for Hovership packages, one per tier). Report services first. */
function rateKeys(services: Service[]) {
  const order = (x: Service) => (x.operation === 'hovership' ? 0 : 1) * 10 + (x.fromReport ? 0 : 1);
  return services
    .filter((x) => x.active)
    .sort((a, b) => order(a) - order(b) || (a.code === 'other' ? 1 : 0) - (b.code === 'other' ? 1 : 0) || a.name.localeCompare(b.name))
    .flatMap((x) => (x.code === 'hovership_packages' ? (['t1_3', 't4'] as const) : [null]).map((tier) => ({ service: x, tier: tier as Tier })));
}

interface RateDraft { serviceTypeId?: string; tier?: Tier; current?: RateRow }

function RatesTab({ data }: { data: Setup }) {
  const t = useT();
  const f = useFormat();
  const locale = useLocale();
  const [history, setHistory] = useState(false);
  const [editing, setEditing] = useState<RateDraft | null>(null);
  const today = todayLA();
  const opName = (code: string) => data.operations.find((o) => o.code === code)?.name ?? code;
  const label = (x: Service, tier: Tier) => (tier ? t(`tier.${tier}` as MessageKey) : serviceLabel(x, locale));

  const rows = rateKeys(data.services).map(({ service, tier }) => {
    const all = data.rates.filter((r) => r.serviceCode === service.code && r.operation === service.operation && r.tier === tier);
    return {
      service, tier,
      current: all.find((r) => r.current),
      upcoming: all.filter((r) => r.effectiveFrom > today),
      older: all.filter((r) => !r.current && r.effectiveFrom <= today),
    };
  });

  const statusOf = (service: Service, r: RateRow | undefined) => {
    if (!r) return service.unit === 'job' ? <Pill tone="muted">{t('rates.perJobShort')}</Pill> : <Pill tone="warn">{t('rates.toLoad')}</Pill>;
    if (r.driverRateCents == null) return <Pill tone="warn">{t('rates.driverMissing')}</Pill>;
    return <Pill tone="ok">{t(service.unit === 'job' ? 'rates.defaultAmounts' : 'rates.active')}</Pill>;
  };

  const cells = (service: Service, tier: Tier, r: RateRow | undefined, status: React.ReactNode, action: React.ReactNode) => (
    <>
      <td>{opName(service.operation)}</td>
      <td>{label(service, tier)}</td>
      <td>{t(`unit.${service.unit}` as MessageKey)}</td>
      {data.showMoney && <td className="r num">{r?.clientRateCents != null ? f.money(r.clientRateCents) : '–'}</td>}
      <td className="r num">{r?.driverRateCents != null ? f.money(r.driverRateCents) : '–'}</td>
      {data.showMoney && <td className="r num">{r?.clientRateCents != null && r.driverRateCents != null ? f.money(r.clientRateCents - r.driverRateCents) : '–'}</td>}
      <td className="num">{r ? f.date(r.effectiveFrom) : '–'}</td>
      <td>{status}</td>
      {data.canEdit && <td className="r">{action}</td>}
    </>
  );

  return (
    <Panel title={t('setup.tab.rates')} id="rates"
      aside={data.canEdit && <Button variant="primary" onClick={() => setEditing({})}>{t('rates.add')}</Button>}>
      <div className="panel-body stack">
        <p className="muted" style={{ margin: 0 }}>{t('rates.lead')}</p>
        {!data.showMoney && <p className="notice notice-info" style={{ margin: 0 }}>{t('rates.hiddenMoney')}</p>}
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">{t('rates.client')}</th><th scope="col">{t('rates.service')}</th><th scope="col">{t('rates.paidPer')}</th>
              {data.showMoney && <th scope="col" className="r">{t('rates.clientPays')}</th>}
              <th scope="col" className="r">{t('rates.driverGets')}</th>
              {data.showMoney && <th scope="col" className="r">{t('rates.aarisaKeeps')}</th>}
              <th scope="col">{t('rates.starts')}</th><th scope="col">{t('rates.status')}</th>
              {data.canEdit && <th scope="col"><span className="visually-hidden">{t('team.actions')}</span></th>}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ service, tier, current, upcoming, older }) => {
              const name = label(service, tier);
              const change = (
                <Button size="sm" aria-label={t(current ? 'rates.changeNamed' : 'rates.setNamed', { name })}
                  onClick={() => setEditing({ serviceTypeId: service.id, tier, current })}>
                  {t(current ? 'rates.change' : service.unit === 'job' ? 'rates.setDefault' : 'rates.add')}
                </Button>
              );
              return [
                ...upcoming.map((r) => <tr key={r.id}>{cells(service, tier, r, <Pill tone="waiting">{t('rates.upcoming')}</Pill>, null)}</tr>),
                <tr key={`${service.id}-${tier}`}>{cells(service, tier, current, statusOf(service, current), change)}</tr>,
                ...(history ? older.map((r) => <tr key={r.id} className="muted">{cells(service, tier, r, <Pill tone="muted">{t('rates.replaced')}</Pill>, null)}</tr>) : []),
              ];
            })}
          </tbody>
        </table>
      </div>
      <div className="panel-body row" style={{ paddingTop: 16 }}>
        <Button size="sm" aria-pressed={history} onClick={() => setHistory((h) => !h)}>{t(history ? 'rates.hideHistory' : 'rates.showHistory')}</Button>
        <span className="muted" style={{ fontSize: 13.5 }}>{t('rates.jobNote')}</span>
      </div>
      {editing && <RateDialog data={data} draft={editing} onClose={() => setEditing(null)} />}
    </Panel>
  );
}

/** Adds a rate, or "changes" one: a change is a new rate with its own start date (rule 2); the old one stays for past weeks. */
function RateDialog({ data, draft, onClose }: { data: Setup; draft: RateDraft; onClose: () => void }) {
  const t = useT();
  const f = useFormat();
  const locale = useLocale();
  const router = useRouter();
  const toast = useToast();
  const choices = data.services.filter((x) => x.active);
  const [serviceTypeId, setService] = useState(draft.serviceTypeId ?? choices[0]?.id ?? '');
  const [tier, setTier] = useState<'t1_3' | 't4'>(draft.tier ?? 't1_3');
  const [client, setClient] = useState(centsToInput(draft.current?.clientRateCents));
  const [driver, setDriver] = useState(centsToInput(draft.current?.driverRateCents));
  const [start, setStart] = useState(todayLA());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const service = data.services.find((x) => x.id === serviceTypeId);
  const tiered = service?.code === 'hovership_packages';
  const clientCents = parseAmount(client);
  const driverCents = parseAmount(driver);
  const fixed = draft.serviceTypeId != null;
  const name = service ? (tiered ? `${serviceLabel(service, locale)}, ${t(`tier.${tier}`)}` : serviceLabel(service, locale)) : '';

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (clientCents === undefined || driverCents === undefined) return setError(t('error.invalid_amount'));
    if (draft.current && start <= draft.current.effectiveFrom) return setError(t('error.start_after_current', { date: f.date(draft.current.effectiveFrom) }));
    setBusy(true);
    try {
      const res = await createRate({ data: { serviceTypeId, tier: tiered ? tier : null, clientRateCents: data.showMoney ? clientCents : (draft.current?.clientRateCents ?? null), driverRateCents: driverCents, effectiveFrom: start } });
      if (!res.ok) return setError(t(`error.${res.code}` as MessageKey));
      toast(t('rates.saved', { date: f.date(start) }));
      await router.invalidate();
      onClose();
    } catch {
      setError(t('error.generic'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={onClose} title={draft.current ? t('rates.changeTitle', { name }) : t('rates.dialogTitle')}>
      <form onSubmit={submit} className="stack">
        {draft.current && <p className="notice notice-info" style={{ margin: 0 }}>{t('rates.changeHint', { date: f.date(draft.current.effectiveFrom) })}</p>}
        {!fixed && (
          <SelectField label={t('rates.service')} value={serviceTypeId} onChange={(e) => setService(e.target.value)}>
            {choices.map((x) => <option key={x.id} value={x.id}>{data.operations.find((o) => o.code === x.operation)?.name} · {serviceLabel(x, locale)}</option>)}
          </SelectField>
        )}
        {tiered && !fixed && (
          <SelectField label={t('rates.tier')} value={tier} onChange={(e) => setTier(e.target.value as 't1_3' | 't4')}>
            <option value="t1_3">{t('tier.t1_3')}</option><option value="t4">{t('tier.t4')}</option>
          </SelectField>
        )}
        {service?.unit === 'job' && <p className="muted" style={{ margin: 0, fontSize: 13.5 }}>{t('rates.jobDefaultHint')}</p>}
        <div className="grid-2">
          {data.showMoney && (
            <TextField label={t('rates.clientPays')} inputMode="decimal" value={client} onChange={(e) => setClient(e.target.value)}
              hint={t('rates.leaveBlank')} error={clientCents === undefined ? t('error.invalid_amount') : undefined} />
          )}
          <TextField label={t('rates.driverGets')} inputMode="decimal" value={driver} onChange={(e) => setDriver(e.target.value)}
            hint={t('rates.leaveBlank')} error={driverCents === undefined ? t('error.invalid_amount') : undefined} />
        </div>
        <TextField label={t('rates.starts')} type="date" required value={start} onChange={(e) => setStart(e.target.value)} />
        <FormError>{error}</FormError>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" variant="primary" disabled={busy}>{t('rates.save')}</Button>
        </div>
      </form>
    </Dialog>
  );
}

// ---------------------------------------------------------------- drivers

type Driver = Setup['drivers'][number];

function DriversTab({ data }: { data: Setup }) {
  const t = useT();
  const [editing, setEditing] = useState<Driver | 'new' | null>(null);
  const [addingContractor, setAddingContractor] = useState(false);
  const contractorName = (id: string | null) => (id ? data.contractors.find((c) => c.id === id)?.name ?? '' : t('drivers.aarisa'));
  return (
    <>
      <Panel title={t('setup.tab.drivers')} id="drivers"
        aside={data.canEdit && <Button variant="primary" onClick={() => setEditing('new')}>{t('drivers.add')}</Button>}>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">{t('drivers.name')}</th><th scope="col">{t('drivers.drivesFor')}</th><th scope="col">{t('drivers.worksFor')}</th>
                <th scope="col">{t('drivers.usualRoute')}</th><th scope="col">{t('rates.status')}</th>
                {data.canEdit && <th scope="col"><span className="visually-hidden">{t('team.actions')}</span></th>}
              </tr>
            </thead>
            <tbody>
              {data.drivers.map((d) => (
                <tr key={d.id}>
                  <td><strong>{d.fullName}</strong>{d.hovershipCode && <span className="sub">{d.hovershipCode}</span>}</td>
                  <td>{[d.hovershipCode && 'Hovership', (d.usualRoutes.length > 0 || d.contractorId) && 'T-Force'].filter(Boolean).join(', ') || '–'}</td>
                  <td>{d.contractorId ? <Pill tone="contractor">{contractorName(d.contractorId)}</Pill> : t('drivers.aarisa')}</td>
                  <td>{d.usualRoutes.length ? <span className="row" style={{ gap: 6 }}>{d.usualRoutes.map((r) => <RoutePlate key={r} code={r} size="sm" />)}</span> : <span className="muted">{t('drivers.none')}</span>}</td>
                  <td>{!d.setupComplete ? <Pill tone="warn">{t('drivers.finishSetup')}</Pill> : d.active ? <Pill tone="ok">{t('team.active')}</Pill> : <Pill tone="muted">{t('pill.inactive')}</Pill>}</td>
                  {data.canEdit && <td className="r"><Button size="sm" aria-label={t('drivers.editNamed', { name: d.fullName })} onClick={() => setEditing(d)}>{t('drivers.edit')}</Button></td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      <Panel title={t('drivers.contractorsTitle')} id="contractors"
        aside={data.canEdit && <Button onClick={() => setAddingContractor(true)}>{t('drivers.addContractor')}</Button>}>
        <div className="table-wrap">
          <table>
            <thead><tr><th scope="col">{t('drivers.name')}</th><th scope="col">{t('drivers.contractorRoutes')}</th><th scope="col">{t('rates.status')}</th></tr></thead>
            <tbody>
              {data.contractors.map((c) => (
                <tr key={c.id}>
                  <td><strong>{c.name}</strong> <Pill tone="contractor">{t('pill.contractor')}</Pill></td>
                  <td>{c.routes.length ? <span className="row" style={{ gap: 6 }}>{c.routes.map((r) => <RoutePlate key={r} code={r} size="sm" />)}</span> : <span className="muted">{t('drivers.none')}</span>}</td>
                  <td>{c.active ? <Pill tone="ok">{t('team.active')}</Pill> : <Pill tone="muted">{t('pill.inactive')}</Pill>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      {editing && <DriverDialog data={data} driver={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {addingContractor && <ContractorDialog onClose={() => setAddingContractor(false)} />}
    </>
  );
}

function DriverDialog({ data, driver, onClose }: { data: Setup; driver: Driver | null; onClose: () => void }) {
  const t = useT();
  const router = useRouter();
  const toast = useToast();
  const [form, setForm] = useState({
    fullName: driver?.fullName ?? '', hovershipCode: driver?.hovershipCode ?? '', contractorId: driver?.contractorId ?? '',
    phone: driver?.phone ?? '', aliases: driver?.aliases.join(', ') ?? '', active: driver?.active ?? true,
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((s) => ({ ...s, [k]: v }));
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await saveDriver({ data: { id: driver?.id ?? null, driver: {
        fullName: form.fullName, hovershipCode: form.hovershipCode || null, contractorId: form.contractorId || null,
        phone: form.phone || null, aliases: form.aliases.split(','), active: form.active,
      } } });
      if (!res.ok) return setError(t(`error.${res.code}` as MessageKey));
      toast(t('drivers.saved'));
      await router.invalidate();
      onClose();
    } catch {
      setError(t('error.generic'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onClose={onClose} title={driver ? t('drivers.editNamed', { name: driver.fullName }) : t('drivers.add')}>
      <form onSubmit={submit} className="stack">
        <TextField label={t('drivers.name')} required autoComplete="off" value={form.fullName} onChange={(e) => set('fullName', e.target.value)} />
        <div className="grid-2">
          <TextField label={t('drivers.code')} autoComplete="off" value={form.hovershipCode} onChange={(e) => set('hovershipCode', e.target.value)} />
          <SelectField label={t('drivers.worksFor')} value={form.contractorId} onChange={(e) => set('contractorId', e.target.value)}>
            <option value="">{t('drivers.aarisa')}</option>
            {data.contractors.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </SelectField>
        </div>
        <TextField label={t('drivers.phone')} type="tel" autoComplete="off" value={form.phone} onChange={(e) => set('phone', e.target.value)} />
        <TextField label={t('drivers.aliases')} hint={t('drivers.aliasesHint')} value={form.aliases} onChange={(e) => set('aliases', e.target.value)} />
        <CheckField label={t('drivers.activeLabel')} checked={form.active} onChange={(e) => set('active', e.target.checked)} />
        <FormError>{error}</FormError>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" variant="primary" disabled={busy}>{t('drivers.save')}</Button>
        </div>
      </form>
    </Dialog>
  );
}

function ContractorDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const router = useRouter();
  const toast = useToast();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await createContractor({ data: { name } });
      if (!res.ok) return setError(t(`error.${res.code}` as MessageKey));
      toast(t('drivers.contractorSaved'));
      await router.invalidate();
      onClose();
    } catch {
      setError(t('error.generic'));
    }
  };
  return (
    <Dialog open onClose={onClose} title={t('drivers.addContractor')}>
      <form onSubmit={submit} className="stack">
        <TextField label={t('drivers.contractorName')} required value={name} onChange={(e) => setName(e.target.value)} />
        <FormError>{error}</FormError>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" variant="primary">{t('drivers.saveContractor')}</Button>
        </div>
      </form>
    </Dialog>
  );
}

// ---------------------------------------------------------------- services

function ServicesTab({ data }: { data: Setup }) {
  const t = useT();
  const locale = useLocale();
  const [editing, setEditing] = useState<Service | 'new' | null>(null);
  const opName = (code: string) => data.operations.find((o) => o.code === code)?.name ?? code;
  const list = [...data.services].sort((a, b) => Number(b.active) - Number(a.active) || a.operation.localeCompare(b.operation) || Number(b.fromReport) - Number(a.fromReport) || a.name.localeCompare(b.name));
  return (
    <Panel title={t('setup.tab.services')} id="services"
      aside={data.canEdit && <Button variant="primary" onClick={() => setEditing('new')}>{t('services.add')}</Button>}>
      <p className="panel-body muted" style={{ margin: 0 }}>{t('services.lead')}</p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">{t('rates.service')}</th><th scope="col">{t('rates.client')}</th><th scope="col">{t('rates.paidPer')}</th><th scope="col">{t('rates.status')}</th>
              {data.canEdit && <th scope="col"><span className="visually-hidden">{t('team.actions')}</span></th>}
            </tr>
          </thead>
          <tbody>
            {list.map((x) => (
              <tr key={x.id} className={x.active ? undefined : 'muted'}>
                <td><strong>{serviceLabel(x, locale)}</strong>{locale === 'es' ? x.nameEs && x.nameEs !== x.name && <span className="sub">{x.name}</span> : x.nameEs && x.nameEs !== x.name && <span className="sub" lang="es">{x.nameEs}</span>}</td>
                <td>{opName(x.operation)}</td>
                <td>{t(`unit.${x.unit}` as MessageKey)}</td>
                <td className="row" style={{ gap: 6 }}>
                  {!x.active && <Pill tone="muted">{t('pill.inactive')}</Pill>}
                  <Pill tone={x.fromReport ? 'ok' : 'muted'}>{t(x.fromReport ? 'services.fromReport' : 'services.logged')}</Pill>
                  {x.requiresOrderNumber && <Pill tone="warn">{t('services.needsOrder')}</Pill>}
                  {x.requiresNote && <Pill tone="muted">{t('services.needsNote')}</Pill>}
                </td>
                {data.canEdit && <td className="r"><Button size="sm" aria-label={t('drivers.editNamed', { name: serviceLabel(x, locale) })} onClick={() => setEditing(x)}>{t('drivers.edit')}</Button></td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing && <ServiceDialog service={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </Panel>
  );
}

function ServiceDialog({ service, onClose }: { service: Service | null; onClose: () => void }) {
  const t = useT();
  const router = useRouter();
  const toast = useToast();
  const [form, setForm] = useState({
    operation: (service?.operation ?? 'tforce') as 'tforce' | 'hovership',
    name: service?.name ?? '', nameEs: service?.nameEs ?? '',
    requiresOrderNumber: service?.requiresOrderNumber ?? false, requiresNote: service?.requiresNote ?? false,
    active: service?.active ?? true,
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((s) => ({ ...s, [k]: v }));
  const fromReport = service?.fromReport ?? false;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const common = { name: form.name, nameEs: form.nameEs || null, requiresOrderNumber: form.requiresOrderNumber, requiresNote: form.requiresNote };
      const res = service
        ? await saveService({ data: { id: service.id, ...common, active: form.active } })
        : await createService({ data: { ...common, operation: form.operation } });
      if (!res.ok) return setError(t(`error.${res.code}` as MessageKey));
      toast(t('services.saved'));
      await router.invalidate();
      onClose();
    } catch {
      setError(t('error.generic'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onClose={onClose} title={service ? t('drivers.editNamed', { name: service.name }) : t('services.add')}>
      <form onSubmit={submit} className="stack">
        {!service && (
          <>
            <SelectField label={t('rates.client')} value={form.operation} onChange={(e) => set('operation', e.target.value as 'tforce' | 'hovership')}>
              <option value="tforce">T-Force</option><option value="hovership">Hovership</option>
            </SelectField>
            <p className="muted" style={{ margin: 0, fontSize: 13.5 }}>{t('services.newHint')}</p>
          </>
        )}
        <div className="grid-2">
          <TextField label={t('services.nameEn')} required value={form.name} onChange={(e) => set('name', e.target.value)} />
          <TextField label={t('services.nameEs')} lang="es" value={form.nameEs} onChange={(e) => set('nameEs', e.target.value)} />
        </div>
        {fromReport ? <p className="notice notice-info" style={{ margin: 0 }}>{t('services.reportLocked')}</p> : (
          <>
            <CheckField label={t('services.needsOrder')} checked={form.requiresOrderNumber} onChange={(e) => set('requiresOrderNumber', e.target.checked)} />
            <CheckField label={t('services.needsNote')} checked={form.requiresNote} onChange={(e) => set('requiresNote', e.target.checked)} />
            {service && <CheckField label={t('services.activeLabel')} checked={form.active} onChange={(e) => set('active', e.target.checked)} />}
            {service && !form.active && <p className="muted" style={{ margin: 0, fontSize: 13.5 }}>{t('services.inactiveHint')}</p>}
          </>
        )}
        <FormError>{error}</FormError>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" variant="primary" disabled={busy}>{t('services.save')}</Button>
        </div>
      </form>
    </Dialog>
  );
}

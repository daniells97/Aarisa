import { useState } from 'react';
import { Link, createFileRoute, useRouter } from '@tanstack/react-router';
import { z } from 'zod';
import { useT, type MessageKey } from '~/i18n';
import { todayLA } from '~/domain/dates';
import { createContractor, createRate, getSetup, saveDriver } from '~/server/setup-fns';
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

const JOB_SERVICES = ['pickup', 'grainger', 'recovery_route', 'other'];
const RATE_KEYS: { service: string; tier: 't1_3' | 't4' | null }[] = [
  { service: 'hovership_packages', tier: 't1_3' }, { service: 'hovership_packages', tier: 't4' },
  { service: 'stat', tier: null }, { service: 'pharma_pickup', tier: null }, { service: 'ecommerce', tier: null },
];

function RatesTab({ data }: { data: Setup }) {
  const t = useT();
  const f = useFormat();
  const [history, setHistory] = useState(false);
  const [adding, setAdding] = useState<{ serviceTypeId?: string; tier?: 't1_3' | 't4' | null } | null>(null);
  const today = todayLA();
  const opName = (code: string) => data.operations.find((o) => o.code === code)?.name ?? code;
  const serviceLabel = (code: string, name: string, tier: string | null) => (tier ? t(`tier.${tier}` as MessageKey) : name);

  const rows = RATE_KEYS.flatMap((key) => {
    const service = data.services.find((s) => s.code === key.service);
    if (!service) return [];
    const all = data.rates.filter((r) => r.serviceCode === key.service && r.tier === key.tier);
    const current = all.find((r) => r.current);
    const upcoming = all.filter((r) => r.effectiveFrom > today);
    const older = all.filter((r) => r !== current && r.effectiveFrom <= today);
    return [{ key, service, current, upcoming, older }];
  });

  return (
    <Panel title={t('setup.tab.rates')} id="rates"
      aside={data.canEdit && <Button variant="primary" onClick={() => setAdding({})}>{t('rates.add')}</Button>}>
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
            </tr>
          </thead>
          <tbody>
            {rows.map(({ key, service, current, upcoming, older }) => {
              const label = serviceLabel(service.code, service.name, key.tier);
              const cells = (r: (typeof data.rates)[number] | undefined, status: React.ReactNode) => (
                <>
                  <td>{opName(service.operation)}</td>
                  <td>{label}</td>
                  <td>{t(`unit.${service.unit}` as MessageKey)}</td>
                  {data.showMoney && <td className="r num">{r?.clientRateCents != null ? f.money(r.clientRateCents) : addLink(r)}</td>}
                  <td className="r num">{r?.driverRateCents != null ? f.money(r.driverRateCents) : addLink(r)}</td>
                  {data.showMoney && <td className="r num">{r?.clientRateCents != null && r.driverRateCents != null ? f.money(r.clientRateCents - r.driverRateCents) : '–'}</td>}
                  <td className="num">{r ? f.date(r.effectiveFrom) : '–'}</td>
                  <td>{status}</td>
                </>
              );
              const addLink = (_r: unknown) => data.canEdit
                ? <button type="button" className="btn btn-sm" onClick={() => setAdding({ serviceTypeId: service.id, tier: key.tier })}>{t('rates.add')}</button>
                : '–';
              const statusOf = (r: (typeof data.rates)[number] | undefined) =>
                !r ? <Pill tone="warn">{t('rates.toLoad')}</Pill>
                  : r.driverRateCents == null ? <Pill tone="warn">{t('rates.driverMissing')}</Pill>
                    : <Pill tone="ok">{t('rates.active')}</Pill>;
              return [
                ...upcoming.map((r) => <tr key={r.id}>{cells(r, <Pill tone="waiting">{t('rates.upcoming')}</Pill>)}</tr>),
                <tr key={`${service.id}-${key.tier}`}>{cells(current, statusOf(current))}</tr>,
                ...(history ? older.map((r) => <tr key={r.id} className="muted">{cells(r, <Pill tone="muted">{t('rates.replaced')}</Pill>)}</tr>) : []),
              ];
            })}
            <tr>
              <td>{opName('tforce')}</td>
              <td>{data.services.filter((s) => JOB_SERVICES.includes(s.code)).map((s) => s.name).join(', ')}</td>
              <td>{t('unit.job')}</td>
              <td colSpan={data.showMoney ? 5 : 3} className="muted">{t('rates.perJob')}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div className="panel-body" style={{ paddingTop: 16 }}>
        <Button size="sm" aria-pressed={history} onClick={() => setHistory((h) => !h)}>{t(history ? 'rates.hideHistory' : 'rates.showHistory')}</Button>
      </div>
      {adding && <AddRateDialog data={data} initial={adding} onClose={() => setAdding(null)} />}
    </Panel>
  );
}

function AddRateDialog({ data, initial, onClose }: { data: Setup; initial: { serviceTypeId?: string; tier?: 't1_3' | 't4' | null }; onClose: () => void }) {
  const t = useT();
  const f = useFormat();
  const router = useRouter();
  const toast = useToast();
  const rateable = data.services.filter((s) => !JOB_SERVICES.includes(s.code));
  const [serviceTypeId, setService] = useState(initial.serviceTypeId ?? rateable[0]?.id ?? '');
  const [tier, setTier] = useState<'t1_3' | 't4'>(initial.tier ?? 't1_3');
  const [client, setClient] = useState('');
  const [driver, setDriver] = useState('');
  const [start, setStart] = useState(todayLA());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const service = data.services.find((s) => s.id === serviceTypeId);
  const tiered = service?.code === 'hovership_packages';
  const clientCents = parseAmount(client);
  const driverCents = parseAmount(driver);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (clientCents === undefined || driverCents === undefined) return setError(t('error.invalid_amount'));
    setBusy(true);
    try {
      const res = await createRate({ data: { serviceTypeId, tier: tiered ? tier : null, clientRateCents: data.showMoney ? clientCents : null, driverRateCents: driverCents, effectiveFrom: start } });
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
    <Dialog open onClose={onClose} title={t('rates.dialogTitle')}>
      <form onSubmit={submit} className="stack">
        <SelectField label={t('rates.service')} value={serviceTypeId} onChange={(e) => setService(e.target.value)}>
          {rateable.map((s) => <option key={s.id} value={s.id}>{data.operations.find((o) => o.code === s.operation)?.name} · {s.name}</option>)}
        </SelectField>
        {tiered && (
          <SelectField label={t('rates.tier')} value={tier} onChange={(e) => setTier(e.target.value as 't1_3' | 't4')}>
            <option value="t1_3">{t('tier.t1_3')}</option><option value="t4">{t('tier.t4')}</option>
          </SelectField>
        )}
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
  const opName = (code: string) => data.operations.find((o) => o.code === code)?.name ?? code;
  return (
    <Panel title={t('setup.tab.services')} id="services">
      <p className="panel-body muted" style={{ margin: 0 }}>{t('services.lead')}</p>
      <div className="table-wrap">
        <table>
          <thead><tr><th scope="col">{t('rates.service')}</th><th scope="col">{t('rates.client')}</th><th scope="col">{t('rates.paidPer')}</th><th scope="col">{t('rates.status')}</th></tr></thead>
          <tbody>
            {data.services.map((s) => (
              <tr key={s.id}>
                <td><strong>{s.name}</strong></td>
                <td>{opName(s.operation)}</td>
                <td>{t(`unit.${s.unit}` as MessageKey)}</td>
                <td className="row" style={{ gap: 6 }}>
                  <Pill tone={s.fromReport ? 'ok' : 'muted'}>{t(s.fromReport ? 'services.fromReport' : 'services.logged')}</Pill>
                  {s.requiresOrderNumber && <Pill tone="warn">{t('services.needsOrder')}</Pill>}
                  {s.requiresNote && <Pill tone="muted">{t('services.needsNote')}</Pill>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

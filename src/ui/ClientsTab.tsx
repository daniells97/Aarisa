import { useState } from 'react';
import { useRouter } from '@tanstack/react-router';
import { useT, type MessageKey } from '~/i18n';
import type { getSetup } from '~/server/setup-fns';
import { createClient, deleteClientContact, saveClient, saveClientContact, saveContractRules, saveReportLayout } from '~/server/clients-fns';
import { parseCsv } from '~/integrations/csv';
import { Button } from './Button';
import { Dialog } from './Dialog';
import { CheckField, FormError, SelectField, TextField } from './Field';
import { Panel } from './Panel';
import { Pill } from './Pill';
import { useToast } from './Toast';

// Clients, their contacts and the rules of each contract (stage 6a of the redesign): what used to be
// written in code per client is set here.

type Client = Awaited<ReturnType<typeof getSetup>>['clients'][number];
type Contact = Client['contacts'][number];
type Contract = Client['contracts'][number];
type Result = { ok: true } | { ok: false; code: string };

const ROLES = ['billing', 'claims', 'operations', 'other'] as const;

function useSave() {
  const t = useT();
  const router = useRouter();
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async (call: () => Promise<Result>, done: string, onDone: () => void) => {
    setBusy(true);
    setError(null);
    try {
      const res = await call();
      if (!res.ok) return setError(t(`error.${res.code}` as MessageKey));
      toast(done);
      await router.invalidate();
      onDone();
    } catch {
      setError(t('error.generic'));
    } finally {
      setBusy(false);
    }
  };
  return { save, error, busy };
}

export function ClientsTab({ clients, canEdit }: { clients: Client[]; canEdit: boolean }) {
  const t = useT();
  const [adding, setAdding] = useState(false);
  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <p className="muted" style={{ margin: 0, flex: 1 }}>{t('cl.lead')}</p>
        {canEdit && <Button variant="primary" onClick={() => setAdding(true)}>{t('cl.new')}</Button>}
      </div>
      {adding && <NewClientDialog onClose={() => setAdding(false)} />}
      {clients.map((c) => <ClientPanel key={c.id} client={c} canEdit={canEdit} />)}
    </div>
  );
}

function ClientPanel({ client, canEdit }: { client: Client; canEdit: boolean }) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const [contact, setContact] = useState<Contact | 'new' | null>(null);
  const [contract, setContract] = useState<Contract | null>(null);
  const [layoutOf, setLayoutOf] = useState<Contract | null>(null);
  const details = [client.legalName, client.taxId && `${t('cl.taxId')} ${client.taxId}`, client.billingAddress].filter(Boolean).join(' · ');
  return (
    <Panel title={client.displayName} id={`client-${client.code}`}
      aside={canEdit && <Button size="sm" aria-label={t('cl.editNamed', { name: client.displayName })} onClick={() => setEditing(true)}>{t('cl.edit')}</Button>}>
      <div className="panel-body stack">
        {details ? <p style={{ margin: 0 }}>{details}</p> : <p className="muted" style={{ margin: 0 }}>{t('cl.noDetails')}</p>}
        <h3 className="cond" style={{ margin: 0 }}>{t('cl.contracts')}</h3>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">{t('cl.contract')}</th><th scope="col">{t('cl.driverFrom')}</th><th scope="col">{t('cl.paidEvery')}</th>
              <th scope="col" className="r">{t('cl.terms')}</th><th scope="col">{t('cl.blocks')}</th><th scope="col" className="r">{t('cl.lowPieces')}</th>
              {canEdit && <th scope="col"><span className="visually-hidden">{t('team.actions')}</span></th>}
            </tr>
          </thead>
          <tbody>
            {client.contracts.map((o) => (
              <tr key={o.id}>
                <td><strong>{o.name}</strong>{!o.active && <> <Pill tone="muted">{t('pill.inactive')}</Pill></>}</td>
                <td>{t(`cl.source.${o.driverSource}`)}</td>
                <td>{t(`cl.cycle.${o.payCycle}`)}</td>
                <td className="r num">{t('cl.days', { n: o.paymentTermsDays })}</td>
                <td>{o.blocksPayrollOnExceptions ? t('cl.yes') : t('cl.no')}</td>
                <td className="r num">{(o.lowQuantityThresholdBp / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })}%</td>
                {canEdit && (
                  <td className="r">
                    <span className="row" style={{ justifyContent: 'flex-end', gap: 6 }}>
                      <Button size="sm" aria-label={t('cl.rulesNamed', { name: o.name })} onClick={() => setContract(o)}>{t('cl.rules')}</Button>
                      <Button size="sm" aria-label={t('lay.titleNamed', { name: o.name })} onClick={() => setLayoutOf(o)}>{o.layout.length ? t('lay.button') : t('lay.set')}</Button>
                    </span>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="panel-body row" style={{ justifyContent: 'space-between', paddingTop: 16 }}>
        <h3 className="cond" style={{ margin: 0 }}>{t('cl.contacts')}</h3>
        {canEdit && <Button size="sm" onClick={() => setContact('new')}>{t('cl.addContact')}</Button>}
      </div>
      {client.contacts.length ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">{t('cl.role')}</th><th scope="col">{t('cl.name')}</th><th scope="col">{t('cl.email')}</th><th scope="col">{t('cl.phone')}</th>
                {canEdit && <th scope="col"><span className="visually-hidden">{t('team.actions')}</span></th>}
              </tr>
            </thead>
            <tbody>
              {client.contacts.map((x) => (
                <tr key={x.id}>
                  <td>{t(`cl.role.${x.role}`)}{x.isPrimary && <> <Pill tone="ok">{t('cl.primary')}</Pill></>}</td>
                  <td>{x.fullName ?? '–'}</td>
                  <td>{x.email ?? '–'}</td>
                  <td className="num">{x.phone ?? '–'}</td>
                  {canEdit && <td className="r"><Button size="sm" aria-label={t('cl.editContactNamed', { name: x.fullName ?? x.email ?? '' })} onClick={() => setContact(x)}>{t('cl.edit')}</Button></td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <p className="panel-body muted" style={{ margin: 0, paddingTop: 0 }}>{t('cl.noContacts')}</p>}
      {editing && <ClientDialog client={client} onClose={() => setEditing(false)} />}
      {contact && <ContactDialog clientId={client.id} contact={contact === 'new' ? null : contact} onClose={() => setContact(null)} />}
      {contract && <RulesDialog contract={contract} onClose={() => setContract(null)} />}
      {layoutOf && <LayoutDialog contract={layoutOf} onClose={() => setLayoutOf(null)} />}
    </Panel>
  );
}

function ClientDialog({ client, onClose }: { client: Client; onClose: () => void }) {
  const t = useT();
  const { save, error, busy } = useSave();
  const [form, setForm] = useState({ displayName: client.displayName, legalName: client.legalName ?? '', taxId: client.taxId ?? '', billingAddress: client.billingAddress ?? '', notes: client.notes ?? '' });
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));
  return (
    <Dialog open onClose={onClose} title={t('cl.editNamed', { name: client.displayName })}>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); void save(() => saveClient({ data: { id: client.id, ...form } }), t('cl.saved'), onClose); }}>
        <TextField label={t('cl.displayName')} required maxLength={120} value={form.displayName} onChange={(e) => set('displayName', e.target.value)} />
        <TextField label={t('cl.legalName')} maxLength={160} value={form.legalName} onChange={(e) => set('legalName', e.target.value)} />
        <TextField label={t('cl.taxId')} maxLength={40} value={form.taxId} onChange={(e) => set('taxId', e.target.value)} />
        <TextField label={t('cl.address')} maxLength={300} value={form.billingAddress} onChange={(e) => set('billingAddress', e.target.value)} />
        <TextField label={t('cl.notes')} maxLength={1000} value={form.notes} onChange={(e) => set('notes', e.target.value)} />
        <FormError>{error}</FormError>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" variant="primary" disabled={busy}>{t('cl.save')}</Button>
        </div>
      </form>
    </Dialog>
  );
}

function ContactDialog({ clientId, contact, onClose }: { clientId: string; contact: Contact | null; onClose: () => void }) {
  const t = useT();
  const { save, error, busy } = useSave();
  const [form, setForm] = useState({ role: contact?.role ?? 'billing', fullName: contact?.fullName ?? '', email: contact?.email ?? '', phone: contact?.phone ?? '', isPrimary: contact?.isPrimary ?? true });
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    void save(() => saveClientContact({ data: { id: contact?.id ?? null, clientId, ...form, role: form.role as Contact['role'] } }), t('cl.contactSaved'), onClose);
  };
  return (
    <Dialog open onClose={onClose} title={t(contact ? 'cl.editContact' : 'cl.addContact')}>
      <form className="stack" onSubmit={submit}>
        <SelectField label={t('cl.role')} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Contact['role'] })}>
          {ROLES.map((r) => <option key={r} value={r}>{t(`cl.role.${r}`)}</option>)}
        </SelectField>
        <TextField label={t('cl.name')} maxLength={120} value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} />
        <TextField label={t('cl.email')} type="email" maxLength={200} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} hint={t('cl.reachHint')} />
        <TextField label={t('cl.phone')} type="tel" maxLength={30} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
        <CheckField label={t('cl.primaryHint')} checked={form.isPrimary} onChange={(e) => setForm({ ...form, isPrimary: e.target.checked })} />
        <FormError>{error}</FormError>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          {contact ? <Button onClick={() => void save(() => deleteClientContact({ data: { id: contact.id } }), t('cl.contactRemoved'), onClose)} disabled={busy}>{t('cl.removeContact')}</Button> : <span />}
          <div className="row">
            <Button onClick={onClose}>{t('common.cancel')}</Button>
            <Button type="submit" variant="primary" disabled={busy}>{t('cl.save')}</Button>
          </div>
        </div>
      </form>
    </Dialog>
  );
}

function RulesDialog({ contract, onClose }: { contract: Contract; onClose: () => void }) {
  const t = useT();
  const { save, error, busy } = useSave();
  const [terms, setTerms] = useState(String(contract.paymentTermsDays));
  const [blocks, setBlocks] = useState(contract.blocksPayrollOnExceptions);
  const [low, setLow] = useState(String(contract.lowQuantityThresholdBp / 100));
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const days = Number(terms), pct = Number(low);
    if (!Number.isInteger(days) || days < 0 || days > 365) return;
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) return;
    void save(() => saveContractRules({ data: { id: contract.id, paymentTermsDays: days, blocksPayrollOnExceptions: blocks, lowQuantityThresholdBp: Math.round(pct * 100) } }), t('cl.rulesSaved'), onClose);
  };
  return (
    <Dialog open onClose={onClose} title={t('cl.rulesNamed', { name: contract.name })}>
      <form className="stack" onSubmit={submit}>
        <p className="muted" style={{ margin: 0 }}>{t('cl.rulesHint', { source: t(`cl.source.${contract.driverSource}`) })}</p>
        <TextField label={t('cl.terms')} inputMode="numeric" required value={terms} onChange={(e) => setTerms(e.target.value)} hint={t('cl.termsHint')} />
        <TextField label={t('cl.lowPieces')} inputMode="decimal" required value={low} onChange={(e) => setLow(e.target.value)} hint={t('cl.lowHint')} />
        <CheckField label={t('cl.blocksHint')} checked={blocks} onChange={(e) => setBlocks(e.target.checked)} />
        <FormError>{error}</FormError>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" variant="primary" disabled={busy}>{t('cl.save')}</Button>
        </div>
      </form>
    </Dialog>
  );
}

function NewClientDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const { save, error, busy } = useSave();
  const [form, setForm] = useState({
    clientName: '', contractName: '', driverSource: 'daily_list' as 'daily_list' | 'report_code', payCycle: 'weekly' as 'weekly' | 'biweekly',
    cycleAnchor: '', paymentTermsDays: '30', weeklySettlementKind: 'weekly_statement' as 'weekly_statement' | 'invoice',
  });
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const days = Number(form.paymentTermsDays);
    if (!Number.isInteger(days) || days < 0 || days > 365) return;
    void save(() => createClient({ data: { ...form, paymentTermsDays: days } }), t('cl.created', { name: form.clientName }), onClose);
  };
  return (
    <Dialog open onClose={onClose} title={t('cl.new')}>
      <form className="stack" onSubmit={submit}>
        <p className="muted" style={{ margin: 0 }}>{t('cl.newHint')}</p>
        <TextField label={t('cl.displayName')} required maxLength={120} value={form.clientName} onChange={(e) => set('clientName', e.target.value)} />
        <TextField label={t('cl.contractName')} maxLength={120} value={form.contractName} onChange={(e) => set('contractName', e.target.value)} hint={t('cl.contractNameHint')} />
        <SelectField label={t('cl.driverFrom')} value={form.driverSource} onChange={(e) => set('driverSource', e.target.value as 'daily_list' | 'report_code')}>
          <option value="daily_list">{t('cl.source.daily_list')}</option>
          <option value="report_code">{t('cl.source.report_code')}</option>
        </SelectField>
        <div className="grid-2">
          <SelectField label={t('cl.paidEvery')} value={form.payCycle} onChange={(e) => set('payCycle', e.target.value as 'weekly' | 'biweekly')}>
            <option value="weekly">{t('cl.cycle.weekly')}</option><option value="biweekly">{t('cl.cycle.biweekly')}</option>
          </SelectField>
          <TextField label={t('cl.anchor')} type="date" required value={form.cycleAnchor} onChange={(e) => set('cycleAnchor', e.target.value)} hint={t('cl.anchorHint')} />
        </div>
        <div className="grid-2">
          <TextField label={t('cl.terms')} inputMode="numeric" required value={form.paymentTermsDays} onChange={(e) => set('paymentTermsDays', e.target.value)} />
          <SelectField label={t('cl.billing')} value={form.weeklySettlementKind} onChange={(e) => set('weeklySettlementKind', e.target.value as 'weekly_statement' | 'invoice')}>
            <option value="weekly_statement">{t('cl.billing.weekly_statement')}</option><option value="invoice">{t('cl.billing.invoice')}</option>
          </SelectField>
        </div>
        <FormError>{error}</FormError>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" variant="primary" disabled={busy}>{t('cl.create')}</Button>
        </div>
      </form>
    </Dialog>
  );
}

const MEANINGS = ['work_date', 'driver_code', 'driver_name', 'route_code', 'quantity', 'other_revenue', 'other_revenue_reason', 'bonus', 'expected_pay', 'ignore'] as const;
type Meaning = (typeof MEANINGS)[number];
interface Draft { sourceName: string; meaning: Meaning; required: boolean; service: string; newName: string; newUnit: 'package' | 'stop' | 'piece'; tierCode: string; revenueName: string }

/** A first guess from the column title; the person confirms every column. */
function guess(header: string, source: Contract['driverSource']): Meaning {
  const h = header.toLowerCase();
  if (/date|fecha|day/.test(h)) return 'work_date';
  if (/route|ruta/.test(h)) return source === 'daily_list' ? 'route_code' : 'ignore';
  if (/driver|courier|code|conductor/.test(h) && !/name|nombre/.test(h)) return source === 'report_code' ? 'driver_code' : 'ignore';
  if (/name|nombre/.test(h)) return 'driver_name';
  if (/package|piece|stop|parcel|qty|count|tier|paquete|pieza|parada/.test(h)) return 'quantity';
  return 'ignore';
}

function LayoutDialog({ contract, onClose }: { contract: Contract; onClose: () => void }) {
  const t = useT();
  const { save, error, busy } = useSave();
  const fromLayout = (): Draft[] => contract.layout.map((c) => ({
    sourceName: c.sourceName, meaning: c.meaning as Meaning, required: c.required, service: c.serviceTypeId ?? '', newName: '', newUnit: 'package',
    tierCode: c.tierCode ?? '', revenueName: c.revenueName ?? '',
  }));
  const [rows, setRows] = useState<Draft[]>(fromLayout);
  const [sample, setSample] = useState<string | null>(null);
  const setRow = (i: number, patch: Partial<Draft>) => setRows((rs) => rs.map((r, n) => (n === i ? { ...r, ...patch } : r)));

  const readSample = async (file: File) => {
    const [header = []] = parseCsv(await file.text());
    const known = new Map(rows.map((r) => [r.sourceName.toLowerCase(), r]));
    setRows(header.filter((h) => h.trim()).map((h) => known.get(h.trim().toLowerCase()) ?? {
      sourceName: h.trim(), meaning: guess(h, contract.driverSource), required: true, service: contract.services[0]?.id ?? 'new', newName: '', newUnit: 'package', tierCode: '', revenueName: '',
    }));
    setSample(file.name);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const columns = rows.map((r) => ({
      sourceName: r.sourceName, meaning: r.meaning, required: r.meaning !== 'ignore' && r.required,
      serviceTypeId: r.meaning === 'quantity' && r.service !== 'new' ? r.service || null : null,
      newService: r.meaning === 'quantity' && r.service === 'new' ? { name: r.newName, unit: r.newUnit } : null,
      tierCode: r.meaning === 'quantity' ? r.tierCode || null : null,
      revenueName: r.meaning === 'other_revenue' ? r.revenueName || r.sourceName : null,
    }));
    void save(() => saveReportLayout({ data: { operationId: contract.id, columns } }), t('lay.saved'), onClose);
  };

  return (
    <Dialog open wide onClose={onClose} title={t('lay.titleNamed', { name: contract.name })}>
      <form className="stack" onSubmit={submit}>
        <p className="muted" style={{ margin: 0 }}>{t(contract.driverSource === 'report_code' ? 'lay.hintReport' : 'lay.hintList')}</p>
        <label className="btn" style={{ alignSelf: 'flex-start' }}>
          {t('lay.readSample')}
          <input type="file" accept=".csv,text/csv" className="visually-hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void readSample(f); }} />
        </label>
        {sample && <p className="muted" style={{ margin: 0 }}>{t('lay.readFrom', { file: sample, count: rows.length })}</p>}
        {rows.length > 0 ? (
          <div className="table-wrap">
            <table>
              <thead><tr><th scope="col">{t('lay.column')}</th><th scope="col">{t('lay.means')}</th><th scope="col">{t('lay.service')}</th><th scope="col">{t('lay.required')}</th></tr></thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.sourceName}>
                    <td><strong>{r.sourceName}</strong></td>
                    <td>
                      <SelectField label={t('lay.meansNamed', { column: r.sourceName })} className="compact" value={r.meaning} onChange={(e) => setRow(i, { meaning: e.target.value as Meaning })}>
                        {MEANINGS.map((m) => <option key={m} value={m}>{t(`lay.meaning.${m}`)}</option>)}
                      </SelectField>
                    </td>
                    <td>
                      {r.meaning === 'quantity' && (
                        <div className="stack" style={{ gap: 6 }}>
                          <SelectField label={t('lay.serviceNamed', { column: r.sourceName })} className="compact" value={r.service} onChange={(e) => setRow(i, { service: e.target.value })}>
                            {contract.services.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                            <option value="new">{t('lay.newService')}</option>
                          </SelectField>
                          {r.service === 'new' && (
                            <div className="row" style={{ gap: 6 }}>
                              <TextField label={t('lay.newServiceName')} required maxLength={60} value={r.newName} onChange={(e) => setRow(i, { newName: e.target.value })} />
                              <SelectField label={t('lay.unit')} value={r.newUnit} onChange={(e) => setRow(i, { newUnit: e.target.value as Draft['newUnit'] })}>
                                <option value="package">{t('unit.package')}</option><option value="piece">{t('unit.piece')}</option><option value="stop">{t('unit.stop')}</option>
                              </SelectField>
                            </div>
                          )}
                          <TextField label={t('lay.tier')} maxLength={20} value={r.tierCode} onChange={(e) => setRow(i, { tierCode: e.target.value })} hint={t('lay.tierHint')} />
                        </div>
                      )}
                      {r.meaning === 'other_revenue' && (
                        <TextField label={t('lay.revenueName')} maxLength={60} value={r.revenueName} onChange={(e) => setRow(i, { revenueName: e.target.value })} hint={t('lay.revenueHint')} />
                      )}
                    </td>
                    <td>{r.meaning !== 'ignore' && <CheckField label={t('lay.requiredNamed', { column: r.sourceName })} checked={r.required} onChange={(e) => setRow(i, { required: e.target.checked })} />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="notice notice-info" style={{ margin: 0 }}>{t('lay.empty')}</p>}
        <FormError>{error}</FormError>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" variant="primary" disabled={busy || rows.length === 0}>{t('lay.save')}</Button>
        </div>
      </form>
    </Dialog>
  );
}

import { useState } from 'react';
import { useRouter } from '@tanstack/react-router';
import { useT, type MessageKey } from '~/i18n';
import type { getSetup } from '~/server/setup-fns';
import { deleteClientContact, saveClient, saveClientContact, saveContractRules } from '~/server/clients-fns';
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
  return (
    <div className="stack">
      <p className="muted" style={{ margin: 0 }}>{t('cl.lead')}</p>
      {clients.map((c) => <ClientPanel key={c.id} client={c} canEdit={canEdit} />)}
    </div>
  );
}

function ClientPanel({ client, canEdit }: { client: Client; canEdit: boolean }) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const [contact, setContact] = useState<Contact | 'new' | null>(null);
  const [contract, setContract] = useState<Contract | null>(null);
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
                {canEdit && <td className="r"><Button size="sm" aria-label={t('cl.rulesNamed', { name: o.name })} onClick={() => setContract(o)}>{t('cl.rules')}</Button></td>}
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

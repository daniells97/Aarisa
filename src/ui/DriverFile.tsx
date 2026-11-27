import { useEffect, useState } from 'react';
import { useRouter } from '@tanstack/react-router';
import { useT, type MessageKey } from '~/i18n';
import { todayLA } from '~/domain/dates';
import { createDriverNote, createLoan, getDriverFile, resolveDriverNote } from '~/server/ledger-fns';
import { Button } from './Button';
import { Dialog } from './Dialog';
import { FormError, SelectField, TextField } from './Field';
import { Pill } from './Pill';
import { parseAmount, useFormat } from './format';
import { useToast } from './Toast';

type File = Awaited<ReturnType<typeof getDriverFile>>;

/**
 * A driver's notes and loans (spec additions of Nov 2026): notes anyone on dispatch can write, loans and
 * salary advances the owner records. What is taken back is decided in each payroll (Payroll → the run).
 */
export function DriverFile({ driverId, name, onClose }: { driverId: string; name: string; onClose: () => void }) {
  const t = useT();
  const [file, setFile] = useState<File | null>(null);
  const reload = async () => setFile(await getDriverFile({ data: { driverId } }));
  useEffect(() => { void reload(); }, [driverId]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Dialog open wide onClose={onClose} title={t('df.title', { name })}>
      {!file ? <p className="muted">{t('common.loading')}</p> : (
        <div className="stack">
          <Details file={file} />
          <Notes file={file} onChange={reload} />
          <Loans file={file} onChange={reload} />
        </div>
      )}
    </Dialog>
  );
}

/** Who the person is: name as on the license, how to reach them and who to call in an emergency. */
function Details({ file }: { file: File }) {
  const t = useT();
  const d = file.details;
  const rows: [string, React.ReactNode][] = [
    [t('drivers.phone'), d.phone ? <a href={`tel:${d.phone}`}>{d.phone}</a> : '–'],
    [t('drivers.email'), d.email ? <a href={`mailto:${d.email}`} style={{ overflowWrap: 'anywhere' }}>{d.email}</a> : '–'],
  ];
  if ('licenseNumber' in d) rows.push(
    [t('drivers.license'), d.licenseNumber ?? '–'],
    [t('drivers.address'), d.address ?? '–'],
    [t('drivers.emergency'), d.emergencyName || d.emergencyPhone
      ? <>{d.emergencyName}{d.emergencyPhone && <> · <a href={`tel:${d.emergencyPhone}`}>{d.emergencyPhone}</a></>}</> : '–'],
  );
  return (
    <section className="stack" style={{ gap: 8 }}>
      <h3 style={{ margin: 0 }}>{t('df.details')}</h3>
      <dl className="details-list">
        {rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
      </dl>
    </section>
  );
}

function Notes({ file, onChange }: { file: File; onChange: () => Promise<void> }) {
  const t = useT();
  const f = useFormat();
  const router = useRouter();
  const toast = useToast();
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await createDriverNote({ data: { driverId: file.driver.id, body } });
    if (!res.ok) return setError(t(`error.${res.code}` as MessageKey));
    setBody(''); setError(null);
    await onChange(); await router.invalidate();
  };
  const toggle = async (id: string, resolved: boolean) => {
    const res = await resolveDriverNote({ data: { id, resolved } });
    if (!res.ok) return toast(t(`error.${res.code}` as MessageKey));
    await onChange(); await router.invalidate();
  };
  return (
    <section className="stack" aria-labelledby="df-notes">
      <h3 id="df-notes" style={{ margin: 0 }}>{t('df.notes')}</h3>
      {file.notes.length === 0 && <p className="muted" style={{ margin: 0 }}>{t('df.noNotes')}</p>}
      <ul className="note-list">
        {file.notes.map((n) => (
          <li key={n.id} className={n.resolved ? 'resolved' : undefined}>
            <span style={{ flex: 1 }}>
              {n.body}
              <span className="sub">{[n.author, f.dateTime(n.at)].filter(Boolean).join(' · ')}{n.resolved ? ` · ${t('df.resolved')}` : ''}</span>
            </span>
            {file.canWriteNotes && <Button size="sm" onClick={() => toggle(n.id, !n.resolved)}>{t(n.resolved ? 'df.reopen' : 'df.resolve')}</Button>}
          </li>
        ))}
      </ul>
      {file.canWriteNotes && (
        <form onSubmit={add} className="row" style={{ alignItems: 'flex-end' }}>
          <div style={{ flex: 1 }}><TextField label={t('df.newNote')} hint={t('df.newNoteHint')} required maxLength={1000} value={body} onChange={(e) => setBody(e.target.value)} /></div>
          <Button type="submit">{t('df.addNote')}</Button>
        </form>
      )}
      <FormError>{error}</FormError>
    </section>
  );
}

function Loans({ file, onChange }: { file: File; onChange: () => Promise<void> }) {
  const t = useT();
  const f = useFormat();
  const router = useRouter();
  const toast = useToast();
  const [form, setForm] = useState({ kind: 'advance' as 'loan' | 'advance', amount: '', givenOn: todayLA(), note: '' });
  const [error, setError] = useState<string | null>(null);
  const owed = file.loans.reduce((s, l) => s + l.balanceCents, 0);
  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    const cents = parseAmount(form.amount);
    if (!cents) return setError(t('error.invalid_amount'));
    const res = await createLoan({ data: { driverId: file.driver.id, kind: form.kind, amountCents: cents, givenOn: form.givenOn, note: form.note || null } });
    if (!res.ok) return setError(t(`error.${res.code}` as MessageKey));
    setForm((s) => ({ ...s, amount: '', note: '' })); setError(null);
    toast(t('df.loanAdded'));
    await onChange(); await router.invalidate();
  };
  return (
    <section className="stack" aria-labelledby="df-loans">
      <h3 id="df-loans" style={{ margin: 0 }}>{t('df.loans')} {owed > 0 && <Pill tone="waiting">{t('df.owes', { amount: f.money(owed) })}</Pill>}</h3>
      {file.loans.length === 0 ? <p className="muted" style={{ margin: 0 }}>{t('df.noLoans')}</p> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th scope="col">{t('df.kind')}</th><th scope="col">{t('df.givenOn')}</th><th scope="col" className="r">{t('df.amount')}</th><th scope="col" className="r">{t('df.repaid')}</th><th scope="col" className="r">{t('df.left')}</th></tr></thead>
            <tbody>
              {file.loans.map((l) => (
                <tr key={l.id}>
                  <td>{t(`df.kind.${l.kind}`)}{l.note && <span className="sub">{l.note}</span>}</td>
                  <td>{f.date(l.givenOn)}</td>
                  <td className="r num">{f.money(l.amountCents)}</td>
                  <td className="r num">{f.money(l.amountCents - l.balanceCents)}</td>
                  <td className="r num"><strong>{f.money(l.balanceCents)}</strong></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="muted" style={{ margin: 0, fontSize: 14 }}>{t('df.howRepaid')}</p>
      {file.canLend && (
        <form onSubmit={add} className="stack">
          <div className="grid-2">
            <SelectField label={t('df.kind')} value={form.kind} onChange={(e) => setForm((s) => ({ ...s, kind: e.target.value as 'loan' | 'advance' }))}>
              <option value="advance">{t('df.kind.advance')}</option><option value="loan">{t('df.kind.loan')}</option>
            </SelectField>
            <TextField label={t('df.amount')} inputMode="decimal" required placeholder="0.00" value={form.amount} onChange={(e) => setForm((s) => ({ ...s, amount: e.target.value }))} />
          </div>
          <div className="grid-2">
            <TextField label={t('df.givenOn')} type="date" required value={form.givenOn} onChange={(e) => setForm((s) => ({ ...s, givenOn: e.target.value }))} />
            <TextField label={t('df.note')} maxLength={300} value={form.note} onChange={(e) => setForm((s) => ({ ...s, note: e.target.value }))} />
          </div>
          <FormError>{error}</FormError>
          <div className="row" style={{ justifyContent: 'flex-end' }}><Button type="submit" variant="primary">{t('df.addLoan')}</Button></div>
        </form>
      )}
    </section>
  );
}

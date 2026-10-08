import { useMemo, useState } from 'react';
import { Link, createFileRoute, useRouter } from '@tanstack/react-router';
import { z } from 'zod';
import { useT, type MessageKey } from '~/i18n';
import { todayLA } from '~/domain/dates';
import { claimReady, claimSent, getClaim, getSettlements, savePayment } from '~/server/settlements-fns';
import { Button, Dialog, Figures, FormError, PageHead, Panel, Pill, RoutePlate, SelectField, TextField, WarningDiamond, buttonClass, parseAmount, useFormat, useToast } from '~/ui';
import { clientName, coversText, statusPill } from '~/ui/settlement-text';

type Data = Awaited<ReturnType<typeof getSettlements>>;
type Line = Data['lines'][number];

const search = z.object({ client: z.enum(['all', 'hovership', 'tforce']).optional(), line: z.string().uuid().optional() });

export const Route = createFileRoute('/_app/settlements/')({
  validateSearch: search,
  loaderDeps: ({ search: s }) => ({ client: s.client ?? 'all', line: s.line }),
  loader: async ({ deps }) => ({
    data: await getSettlements({ data: { filter: deps.client } }),
    claim: deps.line ? await getClaim({ data: { lineId: deps.line } }) : null,
  }),
  component: SettlementsPage,
});

function SettlementsPage() {
  const t = useT();
  const f = useFormat();
  const { data, claim } = Route.useLoaderData();
  const { client = 'all', line: selected } = Route.useSearch();
  const [paying, setPaying] = useState(false);
  const s = data.summary;
  const month = f.date(data.previousMonth, { month: 'long' });
  return (
    <>
      <PageHead title={t('st.title')} lead={t('st.lead', { date: f.date(data.today, { weekday: 'long', month: 'long', day: 'numeric' }) })}
        actions={data.canRecord && <Button variant="primary" onClick={() => setPaying(true)}>{t('st.recordPayment')}</Button>} />
      {!data.canRecord && <p className="notice notice-info" style={{ margin: 0 }}>{t('st.readOnly')}</p>}
      <nav className="tabs" aria-label={t('st.filter')}>
        {(['all', 'hovership', 'tforce'] as const).map((c) => (
          <Link key={c} to="/settlements" search={{ client: c }} aria-current={client === c ? 'page' : undefined}>{c === 'all' ? t('st.all') : clientName(c)}</Link>
        ))}
      </nav>
      <Panel>
        <Figures items={[
          { label: t('st.expectedNotDue'), value: f.money(s.expectedNotDue), note: s.unknownAmounts ? t('st.unknownNote', { count: s.unknownAmounts }) : undefined },
          { label: t('st.late'), value: <span className={s.late ? 'neg' : undefined}>{f.money(s.late)}</span>, note: s.lateCount ? t('st.lateNote', { count: s.lateCount }) : t('st.notLate') },
          { label: t('st.paidNotByClient'), value: <span className="row" style={{ gap: 8 }}>{s.paidNotByClient > 0 && <WarningDiamond size={26} />}{t('st.paidNotByClientValue', { count: s.paidNotByClient })}</span>, note: s.paidNotByClient ? t('st.paidNotByClientNote', { amount: f.money(s.paidNotByClientCents) }) : undefined },
          { label: t('st.received', { month }), value: f.money(s.receivedInMonth) },
        ]} />
      </Panel>
      <div className={claim ? 'week-layout' : 'stack'}>
        <Ledger data={data} selected={selected} client={client} />
        {claim && <ClaimPanel claim={claim} canRecord={data.canRecord} />}
      </div>
      <Payments data={data} />
      {paying && <PaymentDialog data={data} onClose={() => setPaying(false)} />}
    </>
  );
}

function Ledger({ data, selected, client }: { data: Data; selected?: string; client: string }) {
  const t = useT();
  const f = useFormat();
  const due = (l: Line) => {
    if (l.paidOn) return t('st.paidOn', { date: f.date(l.paidOn, { month: 'short', day: 'numeric' }) });
    if (!l.expectedDate) return '–';
    const d = f.date(l.expectedDate, { month: 'short', day: 'numeric' });
    return l.operation === 'tforce' && l.kind === 'tforce_weekly' ? t('st.netTerms', { date: d }) : t('st.about', { date: d });
  };
  return (
    <Panel title={t('st.ledger')} id="ledger" aside={!selected && <span className="muted" style={{ fontSize: 13.5 }}>{t('st.pickLine')}</span>}>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">{t('st.client')}</th><th scope="col">{t('st.covers')}</th><th scope="col" className="r">{t('st.expected')}</th>
              <th scope="col" className="r">{t('st.receivedCol')}</th><th scope="col" className="r">{t('st.missing')}</th><th scope="col">{t('st.due')}</th><th scope="col">{t('st.status')}</th>
            </tr>
          </thead>
          <tbody>
            {data.lines.map((l) => {
              const p = statusPill(l.status, l.daysLate, t);
              const covers = coversText(l, t, f);
              return (
                <tr key={l.id} aria-selected={selected === l.id || undefined} className={selected === l.id ? 'row-selected' : undefined}>
                  <td>{clientName(l.operation)}</td>
                  <td>
                    <Link to="/settlements" search={{ client: client as 'all', line: l.id }} aria-label={t('st.openClaim', { what: covers })}>{covers}</Link>
                    {l.job && <span className="sub">{l.job.orderNumber ? t('st.order', { order: l.job.orderNumber }) : t('st.noOrder')}</span>}
                  </td>
                  <td className="r num">{l.expectedCents == null ? <span className="muted">{t('st.unknownAmount')}</span> : f.money(l.expectedCents)}</td>
                  <td className="r num">{l.receivedCents ? f.money(l.receivedCents) : <span className="muted">{t('st.notYet')}</span>}</td>
                  <td className="r num">{l.missingCents == null || l.receivedCents === 0 && l.status === 'open' ? '–' : l.missingCents === l.expectedCents ? t('st.allOfIt') : f.money(l.missingCents)}</td>
                  <td className="num" style={{ whiteSpace: 'nowrap' }}>{due(l)}</td>
                  <td><Pill tone={p.tone}>{p.label}</Pill></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function ClaimPanel({ claim, canRecord }: { claim: Awaited<ReturnType<typeof getClaim>>; canRecord: boolean }) {
  const t = useT();
  const f = useFormat();
  const router = useRouter();
  const toast = useToast();
  const [sentTo, setSentTo] = useState('');
  const [error, setError] = useState<string | null>(null);
  const { line, agreement, checklist } = claim;
  const client = clientName(line.operation);
  const j = line.job;
  const act = async (p: Promise<{ ok: true } | { ok: false; code: string }>, msg: MessageKey) => {
    const res = await p;
    if (!res.ok) return setError(t(`error.${res.code}` as MessageKey));
    setError(null);
    toast(t(msg));
    await router.invalidate();
  };
  const subject = `Aarisa claim: ${j ? `${j.service} ${j.date}${j.orderNumber ? `, order ${j.orderNumber}` : ''}` : coversText(line, t, f)}`;
  const body = j
    ? `Hello,\n\nThis job is missing from your settlement:\n\nOrder: ${j.orderNumber ?? '-'}\nDate: ${j.date}\nNear route: ${j.nearRoute ?? '-'}\nDone by: ${j.payee}\nAgreed amount: ${j.clientAmountCents != null ? f.money(j.clientAmountCents) : '-'}\n${agreement ? `\nAgreed by phone on ${new Date(agreement.at).toLocaleDateString('en-US')}: "${agreement.text}"\n` : ''}\nPlease include it in the next settlement.\n\nAarisa`
    : `Hello,\n\n${coversText(line, t, f)} is not paid in full. Expected ${f.money(line.expectedCents)}, received ${f.money(line.receivedCents)}.\n\nAarisa`;
  return (
    <Panel title={t('st.claimTitle', { client })} id="claim">
      <div className="panel-body stack">
        {j ? (
          <>
            <p style={{ margin: 0 }}>{t(line.paidToPayee ? 'st.claimIntro' : 'st.claimIntroUnpaid', { payee: j.payee, client })}</p>
            <dl className="claim-facts">
              <div><dt>{t('st.c.order')}</dt><dd>{j.orderNumber ?? '–'}</dd></div>
              <div><dt>{t('st.c.date')}</dt><dd>{f.date(j.date, { weekday: 'long', month: 'long', day: 'numeric' })}</dd></div>
              <div><dt>{t('st.c.near')}</dt><dd>{j.nearRoute ? <RoutePlate code={j.nearRoute} size="sm" /> : '–'}</dd></div>
              <div><dt>{t('st.c.doneBy')}</dt><dd>{j.payee}{j.contractor && <> <Pill tone="contractor">{t('pill.contractor')}</Pill></>}</dd></div>
              <div><dt>{t('st.c.agreed', { client })}</dt><dd className="num">{f.money(j.clientAmountCents)}</dd></div>
              <div><dt>{t('st.c.paidTo', { payee: j.payee })}</dt><dd className="num">{f.money(j.payeeAmountCents)}</dd></div>
            </dl>
            {agreement?.text && <blockquote className="agreement"><strong>{t('st.c.agreement')}</strong><br />“{agreement.text}”</blockquote>}
          </>
        ) : <p style={{ margin: 0 }}>{t('st.claimWeek', { client })}</p>}
        <ul className="checks">
          <li>{checklist.orderNumber || !j ? <span className="check-ok" aria-hidden="true">✓</span> : <WarningDiamond size={18} />}{j ? (checklist.orderNumber ? t('st.ck.order') : t('st.ck.noOrder')) : coversText(line, t, f)}</li>
          {j && <li>{checklist.agreementLogged ? <span className="check-ok" aria-hidden="true">✓</span> : <WarningDiamond size={18} />}{agreement ? t('st.ck.agreement', { date: f.date(agreement.at.slice(0, 10), { month: 'long', day: 'numeric' }) }) : t('st.ck.noAgreement')}</li>}
          <li>{checklist.sent ? <span className="check-ok" aria-hidden="true">✓</span> : <span className="check-ok muted" aria-hidden="true">○</span>}{checklist.sent ? t('st.ck.sent', { client, date: f.dateTime(line.claimSentAt!) }) : t('st.ck.notSent', { client })}</li>
        </ul>
        {error && <p role="alert" className="field-error" style={{ margin: 0 }}>{error}</p>}
        {canRecord && line.status !== 'paid' && (
          <div className="stack" style={{ gap: 10 }}>
            {line.status !== 'claim_ready' && line.status !== 'claimed' && <Button onClick={() => act(claimReady({ data: { lineId: line.id } }), 'st.markedMissing')}>{t('st.markMissing')}</Button>}
            <a className={buttonClass('primary')} href={`mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`}>{t('st.emailClaim', { client })}</a>
            <Link className={buttonClass()} to="/settlements/claim/$lineId" params={{ lineId: line.id }}>{t('st.printClaim')}</Link>
            {!checklist.sent && (
              <form className="row" style={{ alignItems: 'flex-end' }} onSubmit={(e) => { e.preventDefault(); void act(claimSent({ data: { lineId: line.id, sentTo: sentTo || null } }), 'st.claimSaved'); }}>
                <div style={{ flex: '1 1 180px' }}><TextField label={t('st.sentTo')} type="email" value={sentTo} onChange={(e) => setSentTo(e.target.value)} /></div>
                <Button type="submit">{t('st.markSent')}</Button>
              </form>
            )}
          </div>
        )}
      </div>
    </Panel>
  );
}

function Payments({ data }: { data: Data }) {
  const t = useT();
  const f = useFormat();
  return (
    <Panel title={t('st.payments')} id="payments">
      {data.payments.length === 0 ? <p className="panel-body muted" style={{ margin: 0 }}>{t('st.noPayments')}</p> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th scope="col">{t('st.p.date')}</th><th scope="col">{t('st.client')}</th><th scope="col" className="r">{t('st.p.amount')}</th><th scope="col">{t('st.p.method')}</th><th scope="col">{t('st.p.reference')}</th></tr></thead>
            <tbody>{data.payments.map((p) => (
              <tr key={p.id}><td className="num">{f.date(p.receivedOn)}</td><td>{clientName(p.operation)}</td><td className="r num">{f.money(p.amountCents)}</td><td>{p.method ?? '–'}</td><td>{p.reference ?? '–'}</td></tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

function PaymentDialog({ data, onClose }: { data: Data; onClose: () => void }) {
  const t = useT();
  const f = useFormat();
  const router = useRouter();
  const toast = useToast();
  const [operation, setOperation] = useState<'hovership' | 'tforce'>(data.filter === 'tforce' ? 'tforce' : 'hovership');
  const [receivedOn, setReceivedOn] = useState(todayLA());
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('ACH');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const open = useMemo(() => data.lines.filter((l) => l.operation === operation && l.status !== 'paid' && l.expectedCents != null), [data.lines, operation]);
  const amountCents = parseAmount(amount);
  const allocations = Object.entries(picked).map(([lineId, v]) => ({ lineId, amountCents: parseAmount(v) ?? 0 })).filter((a) => a.amountCents > 0);
  const allocated = allocations.reduce((s, a) => s + a.amountCents, 0);
  const over = amountCents != null && amountCents !== undefined && allocated > amountCents;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!amountCents) return setError(t('error.invalid_amount'));
    if (over) return setError(t('st.p.over'));
    const res = await savePayment({ data: { operation, receivedOn, amountCents, method: method || null, reference: reference || null, note: note || null, allocations } });
    if (!res.ok) return setError(t(`error.${res.code}` as MessageKey));
    toast(t('st.p.saved'));
    await router.invalidate();
    onClose();
  };
  return (
    <Dialog open onClose={onClose} title={t('st.paymentTitle')}>
      <form className="stack" onSubmit={submit}>
        <div className="grid-2">
          <SelectField label={t('st.p.client')} value={operation} onChange={(e) => { setOperation(e.target.value as 'hovership' | 'tforce'); setPicked({}); }}>
            <option value="hovership">Hovership</option><option value="tforce">T-Force</option>
          </SelectField>
          <TextField label={t('st.p.date')} type="date" required value={receivedOn} onChange={(e) => setReceivedOn(e.target.value)} />
        </div>
        <div className="grid-2">
          <TextField label={t('st.p.amount')} inputMode="decimal" required value={amount} onChange={(e) => setAmount(e.target.value)} error={amountCents === undefined ? t('error.invalid_amount') : undefined} />
          <TextField label={t('st.p.method')} value={method} onChange={(e) => setMethod(e.target.value)} />
        </div>
        <TextField label={t('st.p.reference')} value={reference} onChange={(e) => setReference(e.target.value)} />
        <fieldset className="alloc">
          <legend>{t('st.p.allocate')}</legend>
          <p className="muted" style={{ margin: '0 0 8px', fontSize: 13.5 }}>{t('st.p.allocateHint')}</p>
          {open.length === 0 ? <p className="muted" style={{ margin: 0 }}>{t('st.p.noLines')}</p> : open.map((l) => {
            const checked = l.id in picked;
            const covers = coversText(l, t, f);
            return (
              <div key={l.id} className="alloc-row">
                <label className="row" style={{ gap: 10, flex: 1, minHeight: 44 }}>
                  <input type="checkbox" checked={checked} style={{ width: 22, height: 22, accentColor: 'var(--green)' }}
                    onChange={(e) => setPicked((p) => { const n = { ...p }; if (e.target.checked) n[l.id] = ((l.missingCents ?? 0) / 100).toFixed(2); else delete n[l.id]; return n; })} />
                  <span>{covers}<span className="sub">{t('st.missing')}: {f.money(l.missingCents)}</span></span>
                </label>
                {checked && <input className="input money-input num" inputMode="decimal" aria-label={`${t('st.p.amount')}: ${covers}`} value={picked[l.id]} onChange={(e) => setPicked((p) => ({ ...p, [l.id]: e.target.value }))} />}
              </div>
            );
          })}
          {amountCents != null && amountCents > allocated && <p className="muted" style={{ margin: '8px 0 0' }}>{t('st.p.unallocated', { amount: f.money(amountCents - allocated) })}</p>}
        </fieldset>
        <TextField label={t('st.p.note')} value={note} onChange={(e) => setNote(e.target.value)} />
        <FormError>{error ?? (over ? t('st.p.over') : null)}</FormError>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" variant="primary" disabled={!amountCents || over}>{t('st.p.save', { amount: f.money(amountCents ?? 0) })}</Button>
        </div>
      </form>
    </Dialog>
  );
}

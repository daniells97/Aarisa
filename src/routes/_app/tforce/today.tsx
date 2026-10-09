import { useState } from 'react';
import { Link, createFileRoute, useRouter } from '@tanstack/react-router';
import { z } from 'zod';
import { useT, type MessageKey } from '~/i18n';
import { addDays, todayLA } from '~/domain/dates';
import { addForRoute, assign, assignNew, confirmAll, createRoute, getDay, undoAssign } from '~/server/daily-fns';
import { Button, Dialog, FormError, Icon, PageHead, Panel, PersonPicker, Pill, RoutePlate, TextField, WarningDiamond, buttonClass, useFormat, useToast, type PillTone } from '~/ui';

type Day = Awaited<ReturnType<typeof getDay>>;
type Row = Day['rows'][number];

export const Route = createFileRoute('/_app/tforce/today')({
  validateSearch: z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }),
  loaderDeps: ({ search }) => ({ date: search.date ?? todayLA() }),
  loader: ({ deps }) => getDay({ data: { date: deps.date } }),
  component: TodayPage,
});

const encode = (p: { driverId: string | null; contractorId: string | null }) => (p.driverId ? `d:${p.driverId}` : p.contractorId ? `c:${p.contractorId}` : '');
const decode = (v: string) => (v.startsWith('d:') ? { driverId: v.slice(2) } : v.startsWith('c:') ? { contractorId: v.slice(2) } : null);

function statusOf(r: Row): { key: MessageKey; tone: PillTone } {
  if (r.status === 'no_driver') return { key: 'td.status.no_driver', tone: 'warn' };
  if (r.contractorRoute && r.today.contractorId) return { key: 'td.status.contractor', tone: 'contractor' };
  if (r.status === 'waiting') return { key: 'td.status.waiting', tone: 'waiting' };
  if (r.status === 'changed') return { key: 'td.status.changed', tone: 'ok' };
  if (r.status === 'confirmed') return { key: 'td.status.confirmed', tone: 'ok' };
  return { key: 'td.status.proposed', tone: 'muted' };
}

function TodayPage() {
  const t = useT();
  const f = useFormat();
  const day = Route.useLoaderData();
  const router = useRouter();
  const toast = useToast();
  const dateLabel = f.date(day.date, { weekday: 'short', month: 'short', day: 'numeric' });
  const [addingRoute, setAddingRoute] = useState(false);

  const change = async (r: Row, value: string) => {
    const payee = decode(value);
    const res = await assign({ data: { date: day.date, routeId: r.routeId, payee } });
    if (!res.ok) return toast(t(`error.${res.code}` as MessageKey));
    const name = payee ? (value.startsWith('d:') ? day.options.drivers.find((d) => d.id === value.slice(2))?.name : day.options.contractors.find((c) => c.id === value.slice(2))?.name) : null;
    await router.invalidate();
    toast(name ? t('td.changedToast', { route: r.code, name }) : t('td.noDriverToast', { route: r.code }), async () => {
      const u = await undoAssign({ data: { date: day.date, routeId: r.routeId, previous: res.value.previous } });
      if (!u.ok) return toast(t(`error.${u.code}` as MessageKey));
      await router.invalidate();
      toast(t('td.undone'));
    });
  };

  const confirm = async () => {
    const res = await confirmAll({ data: { date: day.date } });
    if (!res.ok) return toast(t(`error.${res.code}` as MessageKey));
    toast(t('td.confirmedAll', { count: res.value }));
    await router.invalidate();
  };

  // Typed name that isn't on the list: add the person and assign them in one step, with Undo.
  const createAndAssign = async (r: Row, fullName: string) => {
    const res = await assignNew({ data: { date: day.date, routeId: r.routeId, fullName } });
    if (!res.ok) return toast(t(`error.${res.code}` as MessageKey));
    await router.invalidate();
    toast(t('td.newDriverAssigned', { name: res.value.name, route: r.code }), async () => {
      const u = await undoAssign({ data: { date: day.date, routeId: r.routeId, previous: res.value.previous } });
      if (!u.ok) return toast(t(`error.${u.code}` as MessageKey));
      await router.invalidate();
      toast(t('td.undone'));
    });
  };

  const select = (r: Row) => (
    <PersonPicker
      value={encode(r.today)}
      options={day.options}
      disabled={!day.canEdit}
      label={t('td.driverFor', { route: r.code, date: dateLabel })}
      placeholder={r.status === 'no_driver' ? t('td.chooseDriver') : undefined}
      state={r.status === 'no_driver' ? 'missing' : r.status === 'changed' ? 'changed' : undefined}
      onPick={(v) => change(r, v)}
      onCreate={(name) => createAndAssign(r, name)}
    />
  );

  const sourceText = (r: Row) => {
    if (!r.source || r.status === 'proposed') return t(r.contractorRoute ? 'td.src.contractor' : 'td.src.usual');
    const time = r.updatedAt ? new Intl.DateTimeFormat(undefined, { timeZone: 'America/Los_Angeles', hour: 'numeric', minute: '2-digit' }).format(new Date(r.updatedAt)) : '';
    return t(`td.src.${r.source}` as MessageKey, { time });
  };

  const s = day.summary;
  const unknown = day.rows.filter((r) => r.rawName && r.status === 'no_driver');
  return (
    <>
      <PageHead title={t('td.title')} lead={t('td.lead')}
        actions={
          <div className="row">
            <div className="week-nav">
              <Link to="/tforce/today" search={{ date: addDays(day.date, -1) }} aria-label={t('td.prevDay')}><Icon name="chevronLeft" width={18} height={18} /></Link>
              <span className="num">{dateLabel}</span>
              <Link to="/tforce/today" search={{ date: addDays(day.date, 1) }} aria-label={t('td.nextDay')}><Icon name="chevronRight" width={18} height={18} /></Link>
            </div>
            {day.canEdit && <Button onClick={() => setAddingRoute(true)}><Icon name="plus" width={18} height={18} />{t('td.addRoute')}</Button>}
            <Link to="/extra-jobs/new" search={{ date: day.date }} className={buttonClass()}>{t('td.logExtra')}</Link>
          </div>
        } />
      {!day.canEdit && <p className="notice notice-info" style={{ margin: 0 }}>{t('td.readOnly')}</p>}

      <div className="row" role="list" aria-label={t('td.status')}>
        <span role="listitem"><Pill tone="ok">{t('td.sumConfirmed', { count: s.confirmed })}</Pill></span>
        {s.proposed > 0 && <span role="listitem"><Pill tone="muted">{t('td.sumProposed', { count: s.proposed })}</Pill></span>}
        {s.contractor > 0 && <span role="listitem"><Pill tone="contractor">{t('td.sumContractor', { count: s.contractor })}</Pill></span>}
        {s.waiting > 0 && <span role="listitem"><Pill tone="waiting">{t('td.sumWaiting', { count: s.waiting })}</Pill></span>}
        {s.noDriver > 0 && <span role="listitem"><Pill tone="warn">{t('td.sumNoDriver', { count: s.noDriver })}</Pill></span>}
        <span className="muted" role="listitem">{t('td.sumRoutes', { count: s.routes })}</span>
        {day.canEdit && s.proposed > 0 && <Button variant="primary" onClick={confirm} style={{ marginLeft: 'auto' }}>{t('td.confirmAll', { count: s.proposed })}</Button>}
      </div>

      <div className="today-layout">
        <div className="today-list"><Panel>
          {day.rows.length === 0 ? <p className="panel-body" style={{ paddingTop: 20, margin: 0 }}>{t('td.noRoutes')}</p> : (
            <>
              <div className="table-wrap desktop-only">
                <table>
                  <thead><tr><th scope="col">{t('td.route')}</th><th scope="col">{t('td.driverToday')}</th><th scope="col">{t('td.usual')}</th><th scope="col">{t('td.source')}</th><th scope="col">{t('td.status')}</th></tr></thead>
                  <tbody>
                    {day.rows.map((r) => {
                      const st = statusOf(r);
                      return (
                        <tr key={r.routeId}>
                          <td><RoutePlate code={r.code} needsDriver={r.status === 'no_driver'} /></td>
                          <td>{select(r)}{r.rawName && r.status === 'no_driver' && <span className="sub">“{r.rawName}”</span>}</td>
                          <td className="muted">{r.usual.name ?? t('td.none')}</td>
                          <td className="muted">{sourceText(r)}</td>
                          <td><Pill tone={st.tone}>{t(st.key)}</Pill></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <ul className="route-cards phone-only">
                {day.rows.map((r) => {
                  const st = statusOf(r);
                  return (
                    <li key={r.routeId}>
                      <div className="row" style={{ justifyContent: 'space-between' }}>
                        <RoutePlate code={r.code} size="lg" needsDriver={r.status === 'no_driver'} />
                        {r.status !== 'proposed' && r.status !== 'confirmed' && <Pill tone={st.tone}>{t(st.key)}</Pill>}
                      </div>
                      {select(r)}
                      <span className="sub">{r.rawName && r.status === 'no_driver' ? `“${r.rawName}”` : sourceText(r)}</span>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </Panel></div>

        <div className="stack today-aside">
          <Panel title={t('td.needsTitle')} id="needs">
            <div className="panel-body stack">
              {unknown.length === 0 ? <p className="muted" style={{ margin: 0 }}>{t('td.noNeeds')}</p>
                : unknown.map((r) => <UnknownName key={r.routeId} row={r} day={day} />)}
            </div>
          </Panel>
          <Panel title={t('td.waTitle')} id="wa">
            <p className="panel-body muted" style={{ margin: 0 }}>{t('td.waLater')}</p>
          </Panel>
          <Panel title={t('td.changesTitle')} id="changes">
            <div className="panel-body">
              {day.changes.length === 0 ? <p className="muted" style={{ margin: 0 }}>{t('td.noChanges')}</p> : (
                <ol className="change-log">
                  {day.changes.map((c) => (
                    <li key={c.id}>
                      <span className="num muted">{new Intl.DateTimeFormat(undefined, { timeZone: 'America/Los_Angeles', hour: 'numeric', minute: '2-digit' }).format(new Date(c.at))}</span>
                      <span>
                        <RoutePlate code={c.route} size="sm" />{' '}
                        {c.from && c.from !== c.to ? t('td.fromTo', { from: c.from, to: c.to ?? t('td.noDriver') }) : (c.to ?? t('td.noDriver'))}
                        <span className="sub">{c.user ? t('td.by', { who: c.user, source: t(`audit.source.${c.source}` as MessageKey) }) : t('td.src.daily_list')}{c.action === 'undo' ? ` · ${t('audit.action.undo')}` : ''}</span>
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </Panel>
        </div>
      </div>
      {addingRoute && <AddRouteDialog day={day} dateLabel={dateLabel} onClose={() => setAddingRoute(false)} />}
    </>
  );
}

function UnknownName({ row, day }: { row: Row; day: Day }) {
  const t = useT();
  const router = useRouter();
  const toast = useToast();
  const [contractorId, setContractorId] = useState<string | null | undefined>(undefined);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const hint = day.options.contractors.find((c) => row.rawName!.toLowerCase().includes(c.name.toLowerCase()));
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await addForRoute({ data: { date: day.date, routeId: row.routeId, fullName: name, contractorId: contractorId ?? null } });
    if (!res.ok) return setError(t(`error.${res.code}` as MessageKey));
    toast(t('td.added', { name, route: row.code }));
    await router.invalidate();
  };
  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="row" style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}>
        <WarningDiamond size={22} />
        <div><strong>{t('td.unknownTitle', { route: row.code })}</strong><span className="sub" style={{ fontSize: 14 }}>{t('td.unknownBody', { name: row.rawName! })}</span></div>
      </div>
      {day.canEdit && contractorId === undefined && (
        <div className="row">
          {hint && <Button variant="primary" onClick={() => setContractorId(hint.id)}>{t('td.addUnder', { contractor: hint.name })}</Button>}
          {!hint && <Button onClick={() => setContractorId(null)}>{t('td.addOwn')}</Button>}
          <span className="muted" style={{ fontSize: 13.5 }}>{t('td.orPick')}</span>
        </div>
      )}
      {contractorId !== undefined && (
        <form onSubmit={submit} className="stack" style={{ gap: 10 }}>
          <TextField label={t('td.newName')} required value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          {error && <p role="alert" className="field-error" style={{ margin: 0 }}>{error}</p>}
          <div className="row">
            <Button type="submit" variant="primary">{t('td.addAndAssign', { route: row.code })}</Button>
            <Button onClick={() => setContractorId(undefined)}>{t('common.cancel')}</Button>
          </div>
        </form>
      )}
    </div>
  );
}

function AddRouteDialog({ day, dateLabel, onClose }: { day: Day; dateLabel: string; onClose: () => void }) {
  const t = useT();
  const router = useRouter();
  const toast = useToast();
  const [code, setCode] = useState('');
  const [who, setWho] = useState<{ value: string } | { newName: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const whoName = !who ? null : 'newName' in who ? who.newName
    : who.value.startsWith('d:') ? day.options.drivers.find((d) => d.id === who.value.slice(2))?.name
      : day.options.contractors.find((c) => c.id === who.value.slice(2))?.name;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!who || ('value' in who && !who.value)) return setError(t('td.choosePerson'));
    const payee = 'newName' in who ? { newDriverName: who.newName }
      : who.value.startsWith('d:') ? { driverId: who.value.slice(2) } : { contractorId: who.value.slice(2) };
    setBusy(true);
    try {
      const res = await createRoute({ data: { date: day.date, code, payee } });
      if (!res.ok) return setError(t(`error.${res.code}` as MessageKey));
      toast(t('td.routeAdded', { route: res.value.code, name: whoName ?? '' }));
      await router.invalidate();
      onClose();
    } catch {
      setError(t('error.generic'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onClose={onClose} title={t('td.addRouteTitle', { date: dateLabel })}>
      <form onSubmit={submit} className="stack">
        <TextField label={t('td.routeCode')} hint={t('td.routeCodeHint')} required autoComplete="off" autoCapitalize="characters"
          value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} />
        <div className="field">
          <span id="who-label" style={{ fontSize: 14, fontWeight: 500, color: 'var(--ink-2)' }}>{t('td.whoDrives')}</span>
          <PersonPicker
            value={who && 'value' in who ? who.value : ''}
            options={day.options}
            label={t('td.whoDrives')}
            placeholder={who && 'newName' in who ? who.newName : undefined}
            allowNone={false}
            onPick={(v) => setWho({ value: v })}
            onCreate={(name) => setWho({ newName: name })}
          />
          <span className="muted" style={{ fontSize: 13.5 }}>{who && 'newName' in who ? t('picker.create', { name: who.newName }) : t('td.newRouteHint')}</span>
        </div>
        <FormError>{error}</FormError>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" variant="primary" disabled={busy}>{t('td.saveRoute')}</Button>
        </div>
      </form>
    </Dialog>
  );
}

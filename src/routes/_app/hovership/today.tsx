import { useEffect, useState } from 'react';
import { Link, createFileRoute, useRouter } from '@tanstack/react-router';
import { z } from 'zod';
import { useT, type MessageKey } from '~/i18n';
import { addDays, todayLA } from '~/domain/dates';
import { sendHovershipList, addHovershipDriver, coverHovershipDriver, restoreHovershipDrivers, confirmHovershipUsual, getHovershipDay, saveHovershipRoutes, setHovershipDriverOnList, unconfirmHovershipUsual } from '~/server/hovership-fns';
import { Button, Icon, PageHead, Panel, PersonPicker, Pill, buttonClass, useFormat, useToast, type PillTone } from '~/ui';
import { DayTabs } from '~/ui/DayTabs';
import { PersonActions } from '~/ui/PersonActions';
import { NewRecord } from '~/ui/NewRecord';
import { NotesLoansButton } from '~/ui/NotesLoansButton';
import { useNewPerson } from '~/ui/DriverForm';
import { RowRemove } from '~/ui/RowRemove';
import { SortCodes } from '~/ui/SortCodes';
import { createSortCodeFromDay } from '~/server/setup-fns';

export const Route = createFileRoute('/_app/hovership/today')({
  validateSearch: z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }),
  loaderDeps: ({ search }) => ({ date: search.date ?? todayLA() }),
  loader: ({ deps }) => getHovershipDay({ data: { date: deps.date } }),
  component: HovershipTodayPage,
});

type Day = Awaited<ReturnType<typeof getHovershipDay>>;
type Row = Day['rows'][number];

// Same states as T-Force's list: usual (suggested), confirmed, changed; plus off and "no usual routes yet".
const STATUS: Record<Row['status'], { key: MessageKey; tone: PillTone }> = {
  proposed: { key: 'td.status.proposed', tone: 'muted' },
  confirmed: { key: 'td.status.confirmed', tone: 'ok' },
  changed: { key: 'td.status.changed', tone: 'ok' },
  off: { key: 'hd.status.off', tone: 'muted' },
  covered: { key: 'td.status.changed', tone: 'ok' },
  none: { key: 'hd.status.none', tone: 'waiting' },
};

function HovershipTodayPage() {
  const t = useT();
  const f = useFormat();
  const day = Route.useLoaderData();
  const router = useRouter();
  const toast = useToast();
  const dateLabel = f.date(day.date, { weekday: 'short', month: 'short', day: 'numeric' });
  const time = (at: string) => new Intl.DateTimeFormat(undefined, { timeZone: 'America/Los_Angeles', hour: 'numeric', minute: '2-digit' }).format(new Date(at));
  const s = day.summary;
  // The new-record line: open when the list is empty, or after "+ Add record".
  const [adding, setAdding] = useState(false);
  const draftOpen = day.canEdit && (adding || day.rows.length === 0);

  // "Confirm and send list", as on T-Force: confirms the usual routes and emails the list to the people marked for it.
  const send = async () => {
    const res = await sendHovershipList({ data: { date: day.date } });
    if (!res.ok) return toast(t(`error.${res.code}` as MessageKey));
    await router.invalidate();
    toast(res.value.recipients ? t('td.listSentToast', { count: res.value.sent }) : t('td.listNoRecipients'));
  };
  const unconfirm = async () => {
    const res = await unconfirmHovershipUsual({ data: { date: day.date } });
    if (!res.ok) return toast(t(`error.${res.code}` as MessageKey));
    await router.invalidate();
    toast(t('hd.unconfirmedAll', { count: res.value }));
  };

  // Off the list with Undo: it changes the person's platform, never what they already worked.
  const remove = async (r: Row) => {
    const res = await setHovershipDriverOnList({ data: { driverId: r.driverId, on: false } });
    if (!res.ok) return toast(t(`error.${res.code}` as MessageKey));
    await router.invalidate();
    toast(t('hd.removed', { name: r.name }), async () => {
      const u = await setHovershipDriverOnList({ data: { driverId: r.driverId, on: true } });
      if (!u.ok) return toast(t(`error.${u.code}` as MessageKey));
      await router.invalidate();
      toast(t('td.undone'));
    });
  };

  // "Didn't work today": only this day (no routes), one tap, with Undo back to how the day was.
  const offToday = async (r: Row) => {
    const previous = [{ driverId: r.driverId, sortCodeIds: r.suggested ? null : r.sortCodes.map((x) => x.id) }];
    const res = await saveHovershipRoutes({ data: { date: day.date, driverId: r.driverId, sortCodeIds: [] } });
    if (!res.ok) return toast(t(`error.${res.code}` as MessageKey));
    await router.invalidate();
    toast(t('hd.offDone', { name: r.name }), async () => {
      const u = await restoreHovershipDrivers({ data: { date: day.date, previous } });
      if (!u.ok) return toast(t(`error.${u.code}` as MessageKey));
      await router.invalidate();
      toast(t('td.undone'));
    });
  };

  // "Driver today", as on T-Force: someone else runs this person's routes today (Undo puts everyone back).
  // "+ New person…": the same form as Drivers and rates (on Hovership), then it covers the row.
  const [newPerson, newPersonDialog] = useNewPerson(day.options.contractors, { worksTforce: false, worksHovership: true });

  const cover = async (r: Row, by: { driverId: string } | { newName: string }) => {
    const res = await coverHovershipDriver({ data: { date: day.date, driverId: r.driverId, by } });
    if (!res.ok) return toast(t(`error.${res.code}` as MessageKey));
    await router.invalidate();
    const back = 'driverId' in by && by.driverId === r.driverId;
    toast(back ? t('hd.backToUsual', { name: r.name }) : t('hd.coveredToast', { name: r.name, by: res.value.name }), async () => {
      const u = await restoreHovershipDrivers({ data: { date: day.date, previous: res.value.previous } });
      if (!u.ok) return toast(t(`error.${u.code}` as MessageKey));
      await router.invalidate();
      toast(t('td.undone'));
    });
  };

  const picker = (r: Row) => (
    <PersonPicker value={`d:${r.today.driverId}`} options={{ drivers: day.options.drivers, contractors: [] }} disabled={!day.canEdit} allowNone={false}
      label={t('td.driverFor', { route: r.name, date: dateLabel })} state={r.status === 'covered' ? 'changed' : undefined}
      onPick={(v) => v.startsWith('d:') && v.slice(2) !== r.today.driverId && cover(r, { driverId: v.slice(2) })}
      onCreate={(name) => newPerson(name, (d) => cover(r, { driverId: d.id }))} />
  );

  // "+ Create a new route…" in the route picker: added to the contract's routes, then to this row.
  const createSortCode = async (code: string) => {
    const res = await createSortCodeFromDay({ data: { operation: day.operation.code, code } });
    if (!res.ok) { toast(t(`error.${res.code}` as MessageKey)); return null; }
    toast(t('td.sortCodeCreated', { code: res.value.code }));
    return res.value.id;
  };

  const routesOf = (r: Row) => r.status === 'covered' ? (
    <span className="sort-codes">{r.usual.map((u) => <span key={u.id} className="sort-chip">{u.code}</span>)}<span className="sort-hint">{t('hd.runBy', { name: r.today.name })}</span></span>
  ) : (
    <SortCodes onCreate={createSortCode} value={r.sortCodes} suggested={r.suggested} options={day.options.sortCodes} disabled={!day.canEdit} label={t('hd.routesOf', { name: r.name, date: dateLabel })}
      onChange={async (ids) => {
        const res = await saveHovershipRoutes({ data: { date: day.date, driverId: r.driverId, sortCodeIds: ids } });
        if (!res.ok) return toast(t(`error.${res.code}` as MessageKey));
        await router.invalidate();
      }} />
  );

  // Under the name: where today's routes came from, and the usual ones when they differ.
  const about = (r: Row) => [
    r.setBy ? t(r.setBy.source === 'whatsapp' ? 'td.src.whatsapp' : 'td.src.manual', { time: time(r.setBy.at) }) + (r.setBy.user ? ` · ${r.setBy.user}` : '')
      : r.status === 'proposed' ? t('hd.src.usual') : t('hd.src.noUsual'),
    r.status === 'changed' && r.usual.length ? t('td.usualIs', { name: r.usual.map((u) => u.code).join(', ') }) : null,
    r.status === 'covered' ? t('hd.coveredBy', { name: r.today.name }) : null,
  ].filter(Boolean).join(' · ');

  const who = (r: Row) => (
    <><strong>{r.name}</strong>{r.code && <span className="sub">{r.code}</span>}</>
  );

  const actions = (r: Row) => (
    <>
      <PersonActions driverId={r.driverId} name={r.name} date={day.date} op={day.operation.code} openNotes={r.openNotes} owedCents={r.owedCents} canLogExtra={day.canLogExtra} />
    </>
  );
  // The × on each row: "didn't work today" (only this day); on someone already off that day, off the Hovership list. With Undo.
  const removeX = (r: Row) => !day.canEdit ? null : r.status === 'off'
    ? <RowRemove label={t('hd.removeFromList', { name: r.name })} onClick={() => remove(r)} />
    : <RowRemove label={t('td.removeFromDay', { name: r.name })} onClick={() => offToday(r)} />;

  const sentTime = day.sent ? new Intl.DateTimeFormat(undefined, { timeZone: 'America/Los_Angeles', hour: 'numeric', minute: '2-digit' }).format(new Date(day.sent.at)) : '';
  return (
    <>
      {newPersonDialog}
      <PageHead title={t('td.title')} lead={t('hd.lead', { client: day.operation.name })}
        actions={
          <div className="row">
            <div className="week-nav">
              <Link to="/hovership/today" search={{ date: addDays(day.date, -1) }} aria-label={t('td.prevDay')}><Icon name="chevronLeft" width={18} height={18} /></Link>
              <span className="num">{dateLabel}</span>
              <Link to="/hovership/today" search={{ date: addDays(day.date, 1) }} aria-label={t('td.nextDay')}><Icon name="chevronRight" width={18} height={18} /></Link>
            </div>
            <div className="today-buttons">
              {day.canEdit && <Button onClick={() => setAdding(true)}><Icon name="plus" width={18} height={18} />{t('td.addRecord')}</Button>}
              {day.canLogExtra && <Link to="/extra-jobs/new" search={{ date: day.date, op: day.operation.code, from: 'today' }} className={buttonClass()}>{t('td.logExtra')}</Link>}
              <NotesLoansButton drivers={day.options.drivers} />
            </div>
          </div>
        } />
      <DayTabs current="hovership" date={day.date} />
      {!day.canEdit && <p className="notice notice-info" style={{ margin: 0 }}>{t('td.readOnly')}</p>}

      <div className="row" role="list" aria-label={t('td.status')}>
        <span role="listitem"><Pill tone="ok">{t('hd.sumConfirmed', { count: s.confirmed + s.changed })}</Pill></span>
        {s.proposed > 0 && <span role="listitem"><Pill tone="muted">{t('td.sumProposed', { count: s.proposed })}</Pill></span>}
        {s.none > 0 && <span role="listitem"><Pill tone="waiting">{t('hd.sumNone', { count: s.none })}</Pill></span>}
        {s.off > 0 && <span role="listitem"><Pill tone="muted">{t('hd.sumOff', { count: s.off })}</Pill></span>}
        <span role="listitem" className="muted">{t('hd.people', { count: s.drivers })}</span>
        {day.canEdit && (
          <span className="send-list">
            {s.proposed === 0 && s.usualConfirmed > 0 && <Button onClick={unconfirm}>{t('td.unconfirmAll', { count: s.usualConfirmed })}</Button>}
            <Button variant={day.sent && s.proposed === 0 ? 'secondary' : 'primary'} onClick={send} className="confirm-all">
              {t(day.sent && s.proposed === 0 ? 'td.resendList' : 'td.sendList')}
            </Button>
          </span>
        )}
      </div>
      {day.sent
        ? <p className="muted" style={{ margin: 0, fontSize: 14 }}>{t(day.sent.recipients ? 'td.listSent' : 'td.listSentNobody', { time: sentTime, name: day.sent.by ?? '', count: day.sent.recipients })}</p>
        : day.canEdit && <p className="muted" style={{ margin: 0, fontSize: 14 }}>{t('hd.listHint')}</p>}
      {(s.unassigned.length > 0 || s.shared.length > 0) && (
        <div className="notice" role="status" style={{ margin: 0, flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}>
          {s.unassigned.length > 0 && <span>{t('hd.unassigned', { routes: s.unassigned.join(', ') })}</span>}
          {s.shared.map((x) => <span key={x.code}>{t('hd.shared', { route: x.code, who: x.who.join(', ') })}</span>)}
        </div>
      )}

      <div className="today-layout">
        <div className="today-list"><Panel>
          {day.rows.length === 0 && !draftOpen ? <p className="panel-body" style={{ paddingTop: 20, margin: 0 }}>{t('hd.noPeople')}</p> : (
            <>
              <div className="table-wrap desktop-only">
                <table>
                  <thead><tr><th scope="col">{t('td.route')}</th><th scope="col">{t('td.driverToday')}</th><th scope="col">{t('td.sortCode')}</th><th scope="col">{t('td.status')}</th></tr></thead>
                  <tbody>
                    {day.rows.map((r) => (
                      <tr key={r.driverId}>
                        <td>{who(r)}</td>
                        <td>{picker(r)}<span className="sub">{about(r)}</span>{actions(r)}</td>
                        <td>{routesOf(r)}</td>
                        <td><span className="status-cell"><Pill tone={STATUS[r.status].tone}>{t(STATUS[r.status].key)}</Pill>{removeX(r)}</span></td>
                      </tr>
                    ))}
                    {draftOpen && <HovershipRecord day={day} dateLabel={dateLabel} layout="row" focus={adding} onCancel={() => setAdding(false)} />}
                  </tbody>
                </table>
              </div>
              <ul className="route-cards phone-only">
                {day.rows.map((r) => (
                  <li key={r.driverId}>
                    <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div>{who(r)}</div>
                      <span className="status-cell"><Pill tone={STATUS[r.status].tone}>{t(STATUS[r.status].key)}</Pill>{removeX(r)}</span>
                    </div>
                    {picker(r)}
                    <span className="sub">{about(r)}</span>
                    {routesOf(r)}
                    {actions(r)}
                  </li>
                ))}
                {draftOpen && <HovershipRecord day={day} dateLabel={dateLabel} layout="card" focus={adding} onCancel={() => setAdding(false)} />}
              </ul>
            </>
          )}
          {day.canEdit && !draftOpen && (
            <div className="list-add">
              <Button onClick={() => setAdding(true)}><Icon name="plus" width={18} height={18} />{t('td.addRecord')}</Button>
            </div>
          )}
        </Panel></div>
        <div className="stack today-aside today-aside-after">
          <Panel title={t('td.changesTitle')} id="changes">
            <div className="panel-body">
              {day.changes.length === 0 ? <p className="muted" style={{ margin: 0 }}>{t('td.noChanges')}</p> : (
                <ol className="change-log">
                  {day.changes.map((c) => (
                    <li key={c.id}>
                      <span className="num muted">{time(c.at)}</span>
                      <span>
                        <strong>{c.driver}</strong> {t('td.routesSet', { routes: c.sortCodes.join(', ') || t('td.noSortCodes') })}
                        {c.user && <span className="sub">{t('td.by', { who: c.user, source: t(`audit.source.${c.source}` as MessageKey) })}</span>}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </Panel>
        </div>
      </div>
    </>
  );
}

/**
 * A new line on the list: who (someone in the portal, or a new name created on the spot) and their routes
 * today. Saving puts them on the Hovership list, then sets the routes (the first ones become their usual).
 */
function HovershipRecord({ day, dateLabel, layout, onCancel, focus }: { day: Day; dateLabel: string; layout: 'row' | 'card'; onCancel: () => void; focus?: boolean }) {
  const t = useT();
  const router = useRouter();
  const toast = useToast();
  const [who, setWho] = useState<{ driverId: string } | { newName: string } | null>(null);
  const [newPerson, newPersonDialog] = useNewPerson(day.options.contractors, { worksTforce: false, worksHovership: true });
  const [newName, setNewName] = useState('');
  const [routes, setRoutes] = useState<{ id: string; code: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Saves by itself as soon as the person is picked (or a new name typed); routes go on the saved line.
  useEffect(() => { if (who && !busy) void save(); }, [who]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = async () => {
    if (!who) return;
    setBusy(true);
    try {
      const res = await addHovershipDriver({ data: who });
      if (!res.ok) return setError(t(`error.${res.code}` as MessageKey));
      if (routes.length) {
        const r = await saveHovershipRoutes({ data: { date: day.date, driverId: res.value.driverId, sortCodeIds: routes.map((x) => x.id) } });
        if (!r.ok) toast(t(`error.${r.code}` as MessageKey));
      }
      toast(t(res.value.created ? 'hd.addedNew' : 'hd.recordSaved', { name: res.value.name }));
      setWho(null); setRoutes([]); setError(null);
      await router.invalidate();
    } catch {
      setError(t('error.generic'));
    } finally {
      setBusy(false);
    }
  };
  const allCodes = [...day.options.sortCodes, ...routes.filter((r) => !day.options.sortCodes.some((o) => o.id === r.id))];
  const name = !who ? '' : 'newName' in who ? who.newName : day.options.others.find((o) => o.id === who.driverId)?.name ?? newName;
  const cells = [
    <span key="code" className="muted">{'newName' in (who ?? {}) ? t('hd.newPerson') : '—'}</span>,
    <PersonPicker key="who" value={who && 'driverId' in who ? `d:${who.driverId}` : ''} options={{ drivers: day.options.others, contractors: [] }}
      label={t('hd.whoNew', { date: dateLabel })} placeholder={who && 'newName' in who ? who.newName : t('td.whoDrives')} allowNone={false} emptyHint={t('hd.whoHint')}
      onPick={(v) => v.startsWith('d:') && setWho({ driverId: v.slice(2) })} onCreate={(n) => newPerson(n, (d) => { setNewName(d.name); setWho({ driverId: d.id }); })} />,
    <SortCodes key="routes" value={routes} options={allCodes} label={t('hd.routesOf', { name: name || '…', date: dateLabel })}
      onChange={(ids) => setRoutes(ids.map((id) => allCodes.find((c) => c.id === id)!).filter(Boolean))}
      onCreate={async (typed) => {
        const res = await createSortCodeFromDay({ data: { operation: day.operation.code, code: typed } });
        if (!res.ok) { toast(t(`error.${res.code}` as MessageKey)); return null; }
        setRoutes((rs) => [...rs, { id: res.value.id, code: res.value.code }]);
        return res.value.id;
      }} />,
  ];
  return <>{newPersonDialog}<NewRecord cells={layout === 'card' ? cells.slice(1) : cells} layout={layout} busy={busy} error={error} onCancel={onCancel} focus={focus} /></>;
}

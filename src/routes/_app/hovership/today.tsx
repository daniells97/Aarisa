import { useState } from 'react';
import { Link, createFileRoute, useRouter } from '@tanstack/react-router';
import { z } from 'zod';
import { useT, type MessageKey } from '~/i18n';
import { addDays, todayLA } from '~/domain/dates';
import { addHovershipDriver, coverHovershipDriver, restoreHovershipDrivers, confirmHovershipUsual, getHovershipDay, saveHovershipRoutes, setHovershipDriverOnList, unconfirmHovershipUsual } from '~/server/hovership-fns';
import { Button, Dialog, FormError, Icon, PageHead, Panel, PersonPicker, Pill, buttonClass, useFormat, useToast, type PillTone } from '~/ui';
import { DayTabs } from '~/ui/DayTabs';
import { PersonActions } from '~/ui/PersonActions';
import { SortCodes } from '~/ui/SortCodes';

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
  const [adding, setAdding] = useState(false);

  const confirm = async () => {
    const res = await confirmHovershipUsual({ data: { date: day.date } });
    if (!res.ok) return toast(t(`error.${res.code}` as MessageKey));
    await router.invalidate();
    toast(t('hd.confirmedAll', { count: res.value }), unconfirm);
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

  // "Driver today", as on T-Force: someone else runs this person's routes today (Undo puts everyone back).
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
      onCreate={(name) => cover(r, { newName: name })} />
  );

  const routesOf = (r: Row) => r.status === 'covered' ? (
    <span className="sort-codes">{r.usual.map((u) => <span key={u.id} className="sort-chip">{u.code}</span>)}<span className="sort-hint">{t('hd.runBy', { name: r.today.name })}</span></span>
  ) : (
    <SortCodes value={r.sortCodes} suggested={r.suggested} options={day.options.sortCodes} disabled={!day.canEdit} label={t('hd.routesOf', { name: r.name, date: dateLabel })}
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
    <><strong style={{ whiteSpace: 'nowrap' }}>{r.name}</strong>{r.code && <span className="sub">{r.code}</span>}</>
  );

  const actions = (r: Row) => (
    <>
      <PersonActions driverId={r.driverId} name={r.name} date={day.date} op={day.operation.code} openNotes={r.openNotes} owedCents={r.owedCents} canLogExtra={day.canLogExtra}
        onRemove={day.canEdit ? () => remove(r) : undefined} />
    </>
  );

  return (
    <>
      <PageHead title={t('td.title')} lead={t('hd.lead', { client: day.operation.name })}
        actions={
          <div className="row">
            <div className="week-nav">
              <Link to="/hovership/today" search={{ date: addDays(day.date, -1) }} aria-label={t('td.prevDay')}><Icon name="chevronLeft" width={18} height={18} /></Link>
              <span className="num">{dateLabel}</span>
              <Link to="/hovership/today" search={{ date: addDays(day.date, 1) }} aria-label={t('td.nextDay')}><Icon name="chevronRight" width={18} height={18} /></Link>
            </div>
            {day.canEdit && <Button onClick={() => setAdding(true)}><Icon name="plus" width={18} height={18} />{t('hd.addPerson')}</Button>}
            {day.canLogExtra && <Link to="/extra-jobs/new" search={{ date: day.date, op: day.operation.code }} className={buttonClass()}>{t('td.logExtra')}</Link>}
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
        {day.canEdit && s.proposed > 0 && <Button variant="primary" onClick={confirm} style={{ marginLeft: 'auto' }}>{t('hd.confirmAll', { count: s.proposed })}</Button>}
        {day.canEdit && s.proposed === 0 && s.usualConfirmed > 0 && <Button onClick={unconfirm} style={{ marginLeft: 'auto' }}>{t('td.unconfirmAll', { count: s.usualConfirmed })}</Button>}
      </div>
      {(s.unassigned.length > 0 || s.shared.length > 0) && (
        <div className="notice" role="status" style={{ margin: 0, flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}>
          {s.unassigned.length > 0 && <span>{t('hd.unassigned', { routes: s.unassigned.join(', ') })}</span>}
          {s.shared.map((x) => <span key={x.code}>{t('hd.shared', { route: x.code, who: x.who.join(', ') })}</span>)}
        </div>
      )}

      <div className="today-layout">
        <div className="today-list"><Panel>
          {day.rows.length === 0 ? <p className="panel-body" style={{ paddingTop: 20, margin: 0 }}>{t('hd.noPeople')}</p> : (
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
                        <td><Pill tone={STATUS[r.status].tone}>{t(STATUS[r.status].key)}</Pill></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <ul className="route-cards phone-only">
                {day.rows.map((r) => (
                  <li key={r.driverId}>
                    <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div>{who(r)}</div>
                      {r.status !== 'proposed' && r.status !== 'confirmed' && <Pill tone={STATUS[r.status].tone}>{t(STATUS[r.status].key)}</Pill>}
                    </div>
                    {picker(r)}
                    {routesOf(r)}
                    <span className="sub">{about(r)}</span>
                    {actions(r)}
                  </li>
                ))}
              </ul>
            </>
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
      {adding && <AddPersonDialog day={day} onClose={() => setAdding(false)} />}
    </>
  );
}

/** Someone already in the portal, or a new name typed in the same picker (created on the spot). */
function AddPersonDialog({ day, onClose }: { day: Day; onClose: () => void }) {
  const t = useT();
  const router = useRouter();
  const toast = useToast();
  const [who, setWho] = useState<{ driverId: string } | { newName: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const options = { drivers: day.options.others, contractors: [] };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!who) return setError(t('td.choosePerson'));
    setBusy(true);
    try {
      const res = await addHovershipDriver({ data: who });
      if (!res.ok) return setError(t(`error.${res.code}` as MessageKey));
      toast(t(res.value.created ? 'hd.addedNew' : 'hd.added', { name: res.value.name }));
      await router.invalidate();
      onClose();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onClose={onClose} title={t('hd.addPersonTitle', { client: day.operation.name })}>
      <form onSubmit={submit} className="stack">
        <div className="field">
          <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--ink-2)' }}>{t('hd.person')}</span>
          <PersonPicker value={who && 'driverId' in who ? `d:${who.driverId}` : ''} options={options} label={t('hd.person')} allowNone={false}
            placeholder={who && 'newName' in who ? who.newName : undefined}
            onPick={(v) => setWho(v.startsWith('d:') ? { driverId: v.slice(2) } : null)} onCreate={(name) => setWho({ newName: name })} />
          <span className="muted" style={{ fontSize: 13.5 }}>{who && 'newName' in who ? t('picker.create', { name: who.newName }) : t('hd.addPersonHint')}</span>
        </div>
        <FormError>{error}</FormError>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" variant="primary" disabled={busy}>{t('hd.addPerson')}</Button>
        </div>
      </form>
    </Dialog>
  );
}

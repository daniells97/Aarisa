import { useEffect, useState } from 'react';
import { Link, createFileRoute, useRouter } from '@tanstack/react-router';
import { z } from 'zod';
import { useT, type MessageKey } from '~/i18n';
import { addDays, todayLA } from '~/domain/dates';
import { removeRow, restoreRow, setStatus, addPerson, bringUsualDrivers, confirmAll, giveCode, removePerson, savePersonSortCodes, sendList, setPerson, assign, createRoute, getDay, markOff, saveSortCodes, unconfirmAll, undoAssign } from '~/server/daily-fns';
import { SortCodes } from '~/ui/SortCodes';
import { createSortCodeFromDay } from '~/server/setup-fns';
import { DayTabs } from '~/ui/DayTabs';
import { PersonActions } from '~/ui/PersonActions';
import { NewRecord } from '~/ui/NewRecord';
import { NotesLoansButton } from '~/ui/NotesLoansButton';
import { useNewPerson } from '~/ui/DriverForm';
import { RowRemove } from '~/ui/RowRemove';
import { SendListDialog } from '~/ui/SendListDialog';
import { can } from '~/domain/permissions';
import { useLineOrder } from '~/ui/useLineOrder';
import { SortSelect, SortTh } from '~/ui/SortControls';
import { STATUS_TONE, StatusSelect, type RowStatus } from '~/ui/StatusSelect';
import { Button, Dialog, FormError, Icon, PageHead, Panel, PersonPicker, Pill, RoutePlate, TextField, WarningDiamond, buttonClass, useFormat, useToast, type PillTone } from '~/ui';

type Day = Awaited<ReturnType<typeof getDay>>;
type Row = Day['rows'][number];
type NoCode = Day['noCode'][number];
/** A line of the list, person first: a driver code with its person, or a person without driver code yet. */
type Line = { kind: 'code'; r: Row } | { kind: 'person'; p: NoCode };

export const Route = createFileRoute('/_app/tforce/today')({
  validateSearch: z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), op: z.string().regex(/^[a-z0-9_]{1,40}$/).optional() }),
  loaderDeps: ({ search }) => ({ date: search.date ?? todayLA(), op: search.op }),
  loader: ({ deps }) => getDay({ data: { date: deps.date, operation: deps.op } }),
  component: TodayPage,
});

const encode = (p: { driverId: string | null; contractorId: string | null }) => (p.driverId ? `d:${p.driverId}` : p.contractorId ? `c:${p.contractorId}` : '');
const decode = (v: string) => (v.startsWith('d:') ? { driverId: v.slice(2) } : v.startsWith('c:') ? { contractorId: v.slice(2) } : null);

/** "Already on today's list": says where (which driver code, or without code), so nobody has to look for them. */
function whereOnList(day: Day, driverId: string, t: ReturnType<typeof useT>) {
  const name = day.options.drivers.find((d) => d.id === driverId)?.name ?? '';
  const row = day.rows.find((r) => r.today.driverId === driverId && r.status !== 'off' && r.status !== 'no_driver');
  if (row) return t(row.status === 'proposed' ? 'td.alreadyUsual' : 'td.alreadyOnCode', { name, code: row.code });
  if (day.noCode.some((p) => p.driverId === driverId)) return t('td.alreadyNoCode', { name });
  return t('error.already_on_list');
}

function statusOf(r: Row): { key: MessageKey; tone: PillTone } {
  if (r.status === 'off') return { key: 'td.status.off', tone: 'bad' };
  if (r.status === 'no_driver') return { key: 'td.status.no_driver', tone: 'warn' };
  if (r.contractorRoute && r.today.contractorId) return { key: 'td.status.contractor', tone: 'contractor' };
  if (r.status === 'waiting') return { key: 'td.status.waiting', tone: 'waiting' };
  if (r.status === 'changed') return { key: 'td.status.changed', tone: 'ok' };
  if (r.status === 'confirmed') return { key: 'td.status.confirmed', tone: 'ok' };
  return { key: 'td.status.proposed', tone: 'waiting' };
}

function TodayPage() {
  const t = useT();
  const f = useFormat();
  const day = Route.useLoaderData();
  const router = useRouter();
  const toast = useToast();
  const [sending, setSending] = useState(false);
  const { session } = Route.useRouteContext();
  const canManageTeam = !!session.user && can(session.user.role, 'team.manage');
  const dateLabel = f.date(day.date, { weekday: 'short', month: 'short', day: 'numeric' });
  // The new-record line: open when the list is empty, or after "+ Add record".
  const [adding, setAdding] = useState(false);
  // Open after "+ Add record", or by itself when the day has nobody at all (no codes, nobody without code).
  // Only codes with something saved that day are on its list: a day nobody filled starts empty.
  const listed = day.rows.filter((r) => r.saved);
  const draftOpen = day.canEdit && (adding || (listed.length === 0 && day.noCode.length === 0));

  // "+ New person…": the same form as Drivers and rates, then assigned to the row.
  const [newPerson, newPersonDialog] = useNewPerson(day.options.contractors, { worksTforce: true, worksHovership: false });

  const change = async (r: Row, value: string, knownName?: string) => {
    const payee = decode(value);
    // Someone already on another code today: they move here and swap with whoever was here (one line per person).
    const elsewhere = payee && 'driverId' in payee ? day.rows.find((x) => x.routeId !== r.routeId && x.today.driverId === payee.driverId && x.status !== 'off' && x.status !== 'no_driver') : undefined;
    if (elsewhere) {
      const res = await giveCode({ data: { date: day.date, from: { routeId: elsewhere.routeId }, to: { routeId: r.routeId }, operation: day.operation.code, swap: true } });
      if (!res.ok) return toast(t(`error.${res.code}` as MessageKey));
      await router.invalidate();
      return toast(t('td.movedHere', { name: elsewhere.today.name ?? '', from: elsewhere.code, to: r.code }));
    }
    const res = await assign({ data: { date: day.date, routeId: r.routeId, payee } });
    if (!res.ok) return toast(t(`error.${res.code}` as MessageKey));
    const name = knownName ?? (payee ? (value.startsWith('d:') ? day.options.drivers.find((d) => d.id === value.slice(2))?.name : day.options.contractors.find((c) => c.id === value.slice(2))?.name) : null);
    await router.invalidate();
    toast(name ? t('td.changedToast', { route: r.code, name }) : t('td.noDriverToast', { route: r.code }), async () => {
      const u = await undoAssign({ data: { date: day.date, routeId: r.routeId, previous: res.value.previous } });
      if (!u.ok) return toast(t(`error.${u.code}` as MessageKey));
      await router.invalidate();
      toast(t('td.undone'));
    });
  };

  // "Confirm and send list" (the operator's step): confirms the usual drivers and emails the list to the people
  // marked for it in Team access, who then set driver codes and routes.
  // "Confirm N usual drivers": only confirms (with Undo); sending the list is its own button.
  const confirm = async () => {
    const res = await confirmAll({ data: { date: day.date, operation: day.operation.code } });
    if (!res.ok) return toast(t(`error.${res.code}` as MessageKey));
    await router.invalidate();
    toast(t('td.confirmedAll', { count: res.value }), unconfirm);
  };

  // "Bring usual drivers": each code nobody saved yet gets its usual driver, still to confirm.
  const bring = async () => {
    const res = await bringUsualDrivers({ data: { date: day.date, operation: day.operation.code } });
    if (!res.ok) return toast(t(`error.${res.code}` as MessageKey));
    await router.invalidate();
    toast(res.value ? t('td.broughtUsual', { count: res.value }) : t('td.broughtNone'));
  };

  const send = async () => {
    const res = await sendList({ data: { date: day.date, operation: day.operation.code } });
    if (!res.ok) return toast(t(`error.${res.code}` as MessageKey));
    await router.invalidate();
    toast(!res.value.recipients ? t('td.listNoRecipients') : t(res.value.update ? 'td.listUpdateToast' : 'td.listSentToast', { count: res.value.sent }));
  };

  // Back to "usual, not confirmed" for routes confirmed on their usual driver; changes stay.
  const unconfirm = async () => {
    const res = await unconfirmAll({ data: { date: day.date, operation: day.operation.code } });
    if (!res.ok) return toast(t(`error.${res.code}` as MessageKey));
    await router.invalidate();
    toast(t('td.unconfirmedAll', { count: res.value }));
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
      onCreate={(name) => newPerson(name, (d) => change(r, `d:${d.id}`, d.name))}
    />
  );

  // "+ Create a new route…" in the route picker: added to the contract's routes, then to this row.
  const createSortCode = async (code: string) => {
    const res = await createSortCodeFromDay({ data: { operation: day.operation.code, code } });
    if (!res.ok) { toast(t(`error.${res.code}` as MessageKey)); return null; }
    toast(t('td.sortCodeCreated', { code: res.value.code }));
    return res.value.id;
  };

  const routesOf = (r: Row) => (
    <SortCodes onCreate={createSortCode} value={r.sortCodes} suggested={r.sortCodesSuggested} options={day.options.sortCodes} disabled={!day.canEdit} label={t('td.sortCodesFor', { route: r.code, date: dateLabel })}
      onChange={async (ids) => {
        const res = await saveSortCodes({ data: { date: day.date, routeId: r.routeId, sortCodeIds: ids } });
        if (!res.ok) return toast(t(`error.${res.code}` as MessageKey));
        await router.invalidate();
      }} />
  );

  // Under the picker: where today's name came from, and the usual driver when someone else drives.
  const aboutText = (r: Row) => [sourceText(r), r.usual.name && r.today.name !== r.usual.name ? t('td.usualIs', { name: r.usual.name }) : null].filter(Boolean).join(' · ');

  const sourceText = (r: Row) => {
    if (!r.source || r.status === 'proposed') return t(r.contractorRoute ? 'td.src.contractor' : 'td.src.usual');
    const time = r.updatedAt ? new Intl.DateTimeFormat(undefined, { timeZone: 'America/Los_Angeles', hour: 'numeric', minute: '2-digit' }).format(new Date(r.updatedAt)) : '';
    return t(`td.src.${r.source}` as MessageKey, { time });
  };

  // A driver code off the list from now on, with Undo; "Add driver" with the same code brings it back.
  // The × on a line: off this day's list only (the driver code stays for every other day), with Undo putting it back.
  const removeLine = async (r: Row) => {
    const res = await removeRow({ data: { date: day.date, routeId: r.routeId } });
    if (!res.ok) return toast(t(`error.${res.code}` as MessageKey));
    await router.invalidate();
    toast(r.today.name ? t('td.personRemoved', { name: r.today.name }) : t('td.routeRemoved', { route: r.code }), async () => {
      const u = await restoreRow({ data: { date: day.date, routeId: r.routeId, ...res.value } });
      if (!u.ok) return toast(t(`error.${u.code}` as MessageKey));
      await router.invalidate();
      toast(t('td.undone'));
    });
  };

  // "Didn't run today": only this day, one tap, with Undo (the code is back tomorrow with its usual driver).
  const offToday = async (r: Row) => {
    const res = await markOff({ data: { date: day.date, routeId: r.routeId } });
    if (!res.ok) return toast(t(`error.${res.code}` as MessageKey));
    await router.invalidate();
    toast(r.today.name ? t('td.personRemoved', { name: r.today.name }) : t('td.offDone', { route: r.code }), async () => {
      const u = await undoAssign({ data: { date: day.date, routeId: r.routeId, previous: res.value.previous } });
      if (!u.ok) return toast(t(`error.${u.code}` as MessageKey));
      await router.invalidate();
      toast(t('td.undone'));
    });
  };
  // Back on the road after "didn't run": the usual driver again (or pick someone in the field).
  const backOn = async (r: Row) => {
    const payee = r.usual.driverId ? { driverId: r.usual.driverId } : r.usual.contractorId ? { contractorId: r.usual.contractorId } : null;
    if (!payee) return;
    await change(r, payee.driverId ? `d:${payee.driverId}` : `c:${payee.contractorId}`);
  };

  // Shortcuts on today's person (not a contractor): notes and loans, extra job. A "didn't run" line keeps its person.
  const actions = (r: Row) => {
    if (!day.canEdit && !r.today.driverId) return null;
    return r.today.driverId && r.today.name ? (
      <PersonActions driverId={r.today.driverId} name={r.today.name} date={day.date} openNotes={day.ledger[r.today.driverId]?.openNotes}
        owedCents={day.ledger[r.today.driverId]?.owedCents} canLogExtra={day.canLogExtra} />
    ) : null;
  };

  // The × on each row: a person comes off this day's list ("didn't run today", only this day); a driver code
  // nobody drives that day comes off the list. Both with Undo.
  const removeX = (r: Row) => !day.canEdit ? null : emptyCode(r)
    ? <RowRemove label={t('td.removeRoute', { route: r.code })} onClick={() => removeLine(r)} />
    : <RowRemove label={t('td.removeFromDay', { name: r.today.name ?? r.code })} onClick={() => removeLine(r)} />;

  // The driver code of the person on a line: pick another one (they swap with whoever had it) or type a new one.
  // Every code, with who has it today next to it (picking a taken one swaps them).
  const codeOptions = { drivers: day.options.codes.map((c) => {
    const r = day.rows.find((x) => x.routeId === c.id);
    return { id: c.id, name: c.code, contractor: r && r.today.name && r.status !== 'off' && r.status !== 'no_driver' ? r.today.name : null };
  }), contractors: [] };
  const toCode = async (from: { routeId: string } | { executionId: string }, name: string, to: { routeId: string } | { newCode: string }) => {
    const res = await giveCode({ data: { date: day.date, from, to, operation: day.operation.code } });
    if (!res.ok && res.code === 'code_in_use' && 'routeId' in to) {
      // Say who has it, so they free it first (take them off, or give them another code).
      const holder = day.rows.find((x) => x.routeId === to.routeId);
      if (!holder?.today.name) return toast(t('error.code_in_use'));
      return toast(t('td.codeInUse', { code: holder.code, name: holder.today.name }));
    }
    if (!res.ok) return toast(t(`error.${res.code}` as MessageKey));
    await router.invalidate();
    toast(t('td.codeGiven', { name, code: res.value.code }));
  };
  const codePicker = (line: Line) => {
    const name = line.kind === 'code' ? line.r.today.name ?? '' : line.p.name;
    const from = line.kind === 'code' ? { routeId: line.r.routeId } : { executionId: line.p.executionId };
    return (
      <PersonPicker value={line.kind === 'code' ? `d:${line.r.routeId}` : ''} options={codeOptions} disabled={!day.canEdit} allowNone={false}
        label={t('td.codeFor', { name, date: dateLabel })} placeholder={t('td.codePlaceholder')} emptyHint={t('td.codeHint')}
        state={line.kind === 'person' ? 'missing' : undefined}
        createLabel={(typed) => t('td.newCode', { code: typed.toUpperCase().replace(/\s+/g, '') })}
        onPick={(v) => { if (line.kind === 'person' || v.slice(2) !== line.r.routeId) void toCode(from, name, { routeId: v.slice(2) }); }}
        onCreate={(typed) => toCode(from, name, { newCode: typed })} />
    );
  };

  // A person without driver code: who (can be changed), their routes, and "didn't work today" with Undo.
  const personSelect = (p: NoCode) => (
    <PersonPicker value={`d:${p.driverId}`} options={{ drivers: day.options.drivers, contractors: [] }} disabled={!day.canEdit} allowNone={false}
      label={t('td.driverFor', { route: p.name, date: dateLabel })} state="changed"
      onPick={async (v) => {
        if (!v.startsWith('d:') || v.slice(2) === p.driverId) return;
        const res = await setPerson({ data: { executionId: p.executionId, driverId: v.slice(2) } });
        if (!res.ok) return toast(res.code === 'already_on_list' ? whereOnList(day, v.slice(2), t) : t(`error.${res.code}` as MessageKey));
        await router.invalidate();
      }}
      onCreate={(name) => newPerson(name, async (d) => {
        const res = await setPerson({ data: { executionId: p.executionId, driverId: d.id } });
        if (!res.ok) return toast(t(`error.${res.code}` as MessageKey));
        await router.invalidate();
      })} />
  );
  const personRoutes = (p: NoCode) => (
    <SortCodes onCreate={createSortCode} value={p.sortCodes} options={day.options.sortCodes} disabled={!day.canEdit} label={t('hd.routesOf', { name: p.name, date: dateLabel })}
      onChange={async (ids) => {
        const res = await savePersonSortCodes({ data: { executionId: p.executionId, sortCodeIds: ids } });
        if (!res.ok) return toast(t(`error.${res.code}` as MessageKey));
        await router.invalidate();
      }} />
  );
  const removeFromDay = async (p: NoCode) => {
    const res = await removePerson({ data: { executionId: p.executionId } });
    if (!res.ok) return toast(t(`error.${res.code}` as MessageKey));
    await router.invalidate();
    toast(t('td.personRemoved', { name: p.name }), async () => {
      const u = await addPerson({ data: { date: day.date, driverId: res.value.driverId, operation: day.operation.code } });
      if (!u.ok) return toast(t(`error.${u.code}` as MessageKey));
      if (res.value.sortCodeIds.length) await savePersonSortCodes({ data: { executionId: u.value, sortCodeIds: res.value.sortCodeIds } });
      await router.invalidate();
      toast(t('td.undone'));
    });
  };
  const personActions = (p: NoCode) => (
    <PersonActions driverId={p.driverId} name={p.name} date={day.date} openNotes={day.ledger[p.driverId]?.openNotes}
      owedCents={day.ledger[p.driverId]?.owedCents} canLogExtra={day.canLogExtra} />
  );

  // Person first: everyone who works today by name (with or without driver code), then the codes nobody drives.
  // A code with nobody on it. "Didn't run" keeps its person and routes, so it stays a normal line (status in red).
  const emptyCode = (r: Row) => !r.today.name || r.status === 'no_driver';
  const baseLines: Line[] = [
    ...[...listed.filter((r) => !emptyCode(r)).map((r) => ({ kind: 'code' as const, r })), ...day.noCode.map((p) => ({ kind: 'person' as const, p }))]
      .sort((a, b) => (a.kind === 'code' ? a.r.today.name ?? '' : a.p.name).localeCompare(b.kind === 'code' ? b.r.today.name ?? '' : b.p.name)),
    ...listed.filter(emptyCode).map((r) => ({ kind: 'code' as const, r })),
  ];
  // Lines keep their place while people work (by person: a line doesn't jump when its code or status changes);
  // a column can be chosen to sort by.
  const STATUS_RANK: Record<string, number> = { confirmed: 0, changed: 0, proposed: 1, waiting: 1, off: 2, no_driver: 3 };
  const nameOf = (l: Line) => (l.kind === 'code' ? l.r.today.name ?? '' : l.p.name);
  const order = useLineOrder(baseLines,
    (l) => (l.kind === 'person' ? `d:${l.p.driverId}` : l.r.today.driverId && !emptyCode(l.r) ? `d:${l.r.today.driverId}` : `r:${l.r.routeId}`),
    {
      driver: (a, b) => (nameOf(a) || '\uffff').localeCompare(nameOf(b) || '\uffff'),
      code: (a, b) => (a.kind === 'code' ? a.r.code : '\uffff').localeCompare(b.kind === 'code' ? b.r.code : '\uffff'),
      route: (a, b) => ((a.kind === 'code' ? a.r.sortCodes : a.p.sortCodes)[0]?.code ?? '\uffff').localeCompare((b.kind === 'code' ? b.r.sortCodes : b.p.sortCodes)[0]?.code ?? '\uffff'),
      status: (a, b) => (STATUS_RANK[a.kind === 'code' ? a.r.status : a.p.status] ?? 9) - (STATUS_RANK[b.kind === 'code' ? b.r.status : b.p.status] ?? 9),
    }, 'aarisa.sort.tforce');
  const lines = order.lines;
  const sortLabels = { entry: t('sort.entry'), driver: t('sort.driver'), code: t('sort.code'), route: t('sort.route'), status: t('sort.status') };
  const sentTime = day.sent ? new Intl.DateTimeFormat(undefined, { timeZone: 'America/Los_Angeles', hour: 'numeric', minute: '2-digit' }).format(new Date(day.sent.at)) : '';

  // The status of a row, changeable in place: Confirmed, To confirm, Didn't run today (with Undo).
  const statusOptions = (withOff: boolean) => [
    { value: 'confirmed' as const, label: t('td.status.confirmed') },
    { value: 'proposed' as const, label: t('td.statusToConfirm') },
    ...(withOff ? [{ value: 'off' as const, label: t('td.status.off') }] : []),
  ];
  const statusCell = (line: Line) => {
    if (line.kind === 'person') {
      const p = line.p;
      const value: RowStatus = p.status === 'proposed' ? 'proposed' : p.status === 'off' ? 'off' : 'confirmed';
      if (!day.canEdit) return <Pill tone={STATUS_TONE[value]}>{t(value === 'proposed' ? 'td.statusToConfirm' : value === 'off' ? 'td.status.off' : 'td.status.confirmed')}</Pill>;
      return <StatusSelect value={value} tone={value === 'proposed' ? 'muted' : 'ok'} label={t('td.statusOf', { name: p.name })} options={statusOptions(true)}
        onChange={async (v) => {
          const res = await setStatus({ data: { executionId: p.executionId, status: v } });
          if (!res.ok) return toast(t(`error.${res.code}` as MessageKey));
          await router.invalidate();
          const label = v === 'off' ? t('td.status.off') : v === 'proposed' ? t('td.statusToConfirm') : t('td.status.confirmed');
          toast(t('td.statusSet', { name: p.name, status: label }), async () => {
            const u = await setStatus({ data: { executionId: p.executionId, status: value } });
            if (!u.ok) return toast(t(`error.${u.code}` as MessageKey));
            await router.invalidate();
            toast(t('td.undone'));
          });
        }} />;
    }
    const r = line.r;
    const st = statusOf(r);
    // Nobody on the code, or a contractor's own route: a plain pill (nothing to confirm by hand here).
    if (!day.canEdit || r.status === 'no_driver' || r.status === 'waiting') return <Pill tone={st.tone}>{t(st.key)}</Pill>;
    const value: RowStatus = r.status === 'off' ? 'off' : r.status === 'proposed' ? 'proposed' : 'confirmed';
    return <StatusSelect value={value} tone={st.tone} label={t('td.statusOf', { name: r.today.name ?? r.code })} options={statusOptions(true)}
      onChange={async (v) => {
        const res = await setStatus({ data: { date: day.date, routeId: r.routeId, status: v } });
        if (!res.ok) return toast(t(`error.${res.code}` as MessageKey));
        await router.invalidate();
        const label = v === 'off' ? t('td.status.off') : v === 'proposed' ? t('td.statusToConfirm') : t('td.status.confirmed');
        toast(t('td.statusSet', { name: r.today.name ?? r.usual.name ?? r.code, status: label }), async () => {
          const u = await undoAssign({ data: { date: day.date, routeId: r.routeId, previous: res.value.previous } });
          if (!u.ok) return toast(t(`error.${u.code}` as MessageKey));
          await router.invalidate();
          toast(t('td.undone'));
        });
      }} />;
  };

  const s = day.summary;
  const unknown = day.rows.filter((r) => r.rawName && r.status === 'no_driver');
  return (
    <>
      {newPersonDialog}
      {sending && (
        <SendListDialog recipients={day.recipients} people={day.rows.filter((r) => r.today.name && r.status !== 'no_driver').length + day.noCode.length} withoutCode={day.noCode.filter((x) => x.status !== 'off').length}
          sentAt={day.sent?.at ?? null} changed={!!day.sent?.changed} canManageTeam={canManageTeam}
          onSend={send} onClose={() => setSending(false)} />
      )}
      <PageHead stacked title={t('td.title')} lead={t('td.lead', { client: day.operation.name })}
        actions={
          <div className="row">
            <div className="week-nav">
              <Link to="/tforce/today" search={{ date: addDays(day.date, -1), op: day.operation.isDefault ? undefined : day.operation.code }} aria-label={t('td.prevDay')}><Icon name="chevronLeft" width={18} height={18} /></Link>
              <span className="num">{dateLabel}</span>
              <Link to="/tforce/today" search={{ date: addDays(day.date, 1), op: day.operation.isDefault ? undefined : day.operation.code }} aria-label={t('td.nextDay')}><Icon name="chevronRight" width={18} height={18} /></Link>
            </div>
            <div className="today-buttons">
              {day.canEdit && <Button onClick={() => setAdding(true)}><Icon name="plus" width={18} height={18} />{t('td.addRecord')}</Button>}
              {day.canLogExtra && <Link to="/extra-jobs/new" search={{ date: day.date, from: 'today' }} className={buttonClass()}>{t('td.logExtra')}</Link>}
              <NotesLoansButton drivers={day.options.drivers} />
            </div>
          </div>
        } />
      {day.operation.isDefault && <DayTabs current="tforce" date={day.date} />}
      {!day.canEdit && <p className="notice notice-info" style={{ margin: 0 }}>{t('td.readOnly')}</p>}

      <div className="row" role="list" aria-label={t('td.status')}>
        <span role="listitem"><Pill tone="ok">{t('td.sumConfirmed', { count: s.confirmed })}</Pill></span>
        {s.proposed > 0 && <span role="listitem"><Pill tone="waiting">{t('td.sumProposed', { count: s.proposed })}</Pill></span>}
        {s.contractor > 0 && <span role="listitem"><Pill tone="contractor">{t('td.sumContractor', { count: s.contractor })}</Pill></span>}
        {s.waiting > 0 && <span role="listitem"><Pill tone="waiting">{t('td.sumWaiting', { count: s.waiting })}</Pill></span>}
        {s.noDriver > 0 && <span role="listitem"><Pill tone="warn">{t('td.sumNoDriver', { count: s.noDriver })}</Pill></span>}
        {s.off > 0 && <span role="listitem"><Pill tone="bad">{t(s.off === 1 ? 'td.sumOffOne' : 'td.sumOff', { count: s.off })}</Pill></span>}
        {s.noCode > 0 && <span role="listitem"><Pill tone="warn">{t('td.sumNoCode', { count: s.noCode })}</Pill></span>}
        <span className="muted" role="listitem">{t('td.sumPeople', { count: s.people })} · {t('td.sumRoutes', { count: s.routes })}</span>
        {day.canEdit && (
          <span className="send-list">
            {s.usualAvailable > 0 && <Button variant={s.people === 0 ? 'primary' : 'secondary'} onClick={bring}>{t('td.bringUsual', { count: s.usualAvailable })}</Button>}
            {s.proposed > 0 && <Button variant="primary" onClick={confirm} className="confirm-all">{t('td.confirmAll', { count: s.proposed })}</Button>}
            {s.proposed === 0 && s.usualConfirmed > 0 && <Button onClick={unconfirm}>{t('td.unconfirmAll', { count: s.usualConfirmed })}</Button>}
            <Button variant={s.proposed === 0 && (!day.sent || day.sent.changed) ? 'primary' : 'secondary'} onClick={() => setSending(true)} className="confirm-all">
              {t(day.sent ? 'td.resendList' : 'td.sendList')}
            </Button>
          </span>
        )}
      </div>
      {day.sent
        ? <p className="muted" style={{ margin: 0, fontSize: 14 }}>
            {t(day.sent.recipients ? 'td.listSent' : 'td.listSentNobody', { time: sentTime, name: day.sent.by ?? '', count: day.sent.recipients })}
            {day.sent.changed && <> <Pill tone="warn">{t('td.changedSinceSent')}</Pill></>}
          </p>
        : day.canEdit && <p className="muted" style={{ margin: 0, fontSize: 14 }}>{t(listed.length || day.noCode.length ? 'td.listHint' : 'td.emptyDay')}</p>}

      <div className="today-layout">
        <div className="today-list"><Panel>
          {listed.length === 0 && day.noCode.length === 0 && !draftOpen ? <p className="panel-body" style={{ paddingTop: 20, margin: 0 }}>{t(day.rows.length ? 'td.emptyDay' : 'td.noRoutes', { client: day.operation.name })}</p> : (
            <>
              <div className="table-wrap desktop-only">
                <table>
                  <thead><tr>
                    <SortTh label={t('td.person')} k="driver" sort={order.sort} choose={order.choose} />
                    <SortTh label={t('td.codeDriver')} k="code" sort={order.sort} choose={order.choose} />
                    <SortTh label={t('td.sortCode')} k="route" sort={order.sort} choose={order.choose} />
                    <SortTh label={t('td.status')} k="status" sort={order.sort} choose={order.choose} />
                  </tr></thead>
                  <tbody>
                    {lines.map((line) => {
                      if (line.kind === 'person') {
                        const p = line.p;
                        return (
                          <tr key={p.executionId}>
                            <td>{personSelect(p)}<span className="sub">{t('td.noCodeHint')}</span>{personActions(p)}</td>
                            <td className="code-cell">{codePicker(line)}<span className="sub" style={{ color: 'var(--amber-ink)' }}>{t('td.status.noCode')}</span></td>
                            <td>{personRoutes(p)}</td>
                            <td><span className="status-cell">{statusCell(line)}{day.canEdit && <RowRemove label={t('td.removeFromDay', { name: p.name })} onClick={() => removeFromDay(p)} />}</span></td>
                          </tr>
                        );
                      }
                      const r = line.r;
                      const st = statusOf(r);
                      return (
                        <tr key={r.routeId}>
                          <td>{select(r)}<span className="sub">{r.rawName && r.status === 'no_driver' ? `“${r.rawName}”` : aboutText(r)}</span>{actions(r)}</td>
                          <td className="code-cell">{emptyCode(r) ? <RoutePlate code={r.code} needsDriver={r.status === 'no_driver'} /> : codePicker(line)}</td>
                          <td>{routesOf(r)}</td>
                          <td><span className="status-cell">{statusCell(line)}{removeX(r)}</span></td>
                        </tr>
                      );
                    })}
                    {draftOpen && <TforceRecord day={day} dateLabel={dateLabel} layout="row" focus={adding} onCancel={() => setAdding(false)} />}
                  </tbody>
                </table>
              </div>
              <SortSelect sort={order.sort} choose={order.choose} labels={sortLabels} />
              <ul className="route-cards phone-only">
                {lines.map((line) => {
                  if (line.kind === 'person') {
                    const p = line.p;
                    return (
                      <li key={p.executionId}>
                        <div className="row" style={{ justifyContent: 'space-between' }}><Pill tone="warn">{t('td.status.noCode')}</Pill><span className="status-cell">{statusCell(line)}{day.canEdit && <RowRemove label={t('td.removeFromDay', { name: p.name })} onClick={() => removeFromDay(p)} />}</span></div>
                        {personSelect(p)}
                        <div className="card-field"><span className="card-label">{t('td.codeDriver')}</span>{codePicker(line)}</div>
                        <div className="card-field"><span className="card-label">{t('td.sortCode')}</span>{personRoutes(p)}</div>
                        {personActions(p)}
                      </li>
                    );
                  }
                  const r = line.r;
                  const st = statusOf(r);
                  return (
                    <li key={r.routeId}>
                      <div className="row" style={{ justifyContent: emptyCode(r) ? 'space-between' : 'flex-end' }}>
                        {emptyCode(r) && <RoutePlate code={r.code} size="lg" needsDriver={r.status === 'no_driver'} />}
                        <span className="status-cell">{statusCell(line)}{removeX(r)}</span>
                      </div>
                      {select(r)}
                      <span className="sub">{r.rawName && r.status === 'no_driver' ? `“${r.rawName}”` : aboutText(r)}</span>
                      {!emptyCode(r) && <div className="card-field"><span className="card-label">{t('td.codeDriver')}</span>{codePicker(line)}</div>}
                      <div className="card-field"><span className="card-label">{t('td.sortCode')}</span>{routesOf(r)}</div>
                      {actions(r)}
                    </li>
                  );
                })}
                {draftOpen && <TforceRecord day={day} dateLabel={dateLabel} layout="card" focus={adding} onCancel={() => setAdding(false)} />}
              </ul>
            </>
          )}
          {day.canEdit && !draftOpen && (
            <div className="list-add">
              <Button onClick={() => setAdding(true)}><Icon name="plus" width={18} height={18} />{t('td.addRecord')}</Button>
            </div>
          )}
        </Panel></div>

        <div className="stack today-aside">
          <Panel title={t('td.needsTitle')} id="needs">
            <div className="panel-body stack">
              {unknown.length === 0 && day.doubles.length === 0 && <p className="muted" style={{ margin: 0 }}>{t('td.noNeeds')}</p>}
              {day.doubles.map((x) => (
                <div key={x.name} className="row" style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}>
                  <WarningDiamond size={22} />
                  <div><strong>{t('td.doubleTitle', { name: x.name })}</strong><span className="sub" style={{ fontSize: 14 }}>{t('td.doubleBody', { codes: x.codes.join(', ') })}</span></div>
                </div>
              ))}
              {unknown.map((r) => <UnknownName key={r.routeId} row={r} day={day} />)}
            </div>
          </Panel>
          <Panel title={t('td.changesTitle')} id="changes">
            <div className="panel-body">
              {day.changes.length === 0 ? <p className="muted" style={{ margin: 0 }}>{t('td.noChanges')}</p> : (
                <ol className="change-log">
                  {day.changes.map((c) => (
                    <li key={c.id}>
                      <span className="num muted">{new Intl.DateTimeFormat(undefined, { timeZone: 'America/Los_Angeles', hour: 'numeric', minute: '2-digit' }).format(new Date(c.at))}</span>
                      <span>
                        {c.route && <><RoutePlate code={c.route} size="sm" />{' '}</>}
                        {c.left ? t('td.leftList', { name: c.from ?? '' })
                          : !c.route && !c.sortCodes && c.to && !c.from ? t('td.joinedList', { name: c.to })
                          : c.sortCodes ? t('td.routesSet', { routes: c.sortCodes.join(', ') || t('td.noSortCodes') })
                          : c.off ? t('td.status.off') : c.from && c.from !== c.to ? t('td.fromTo', { from: c.from, to: c.to ?? t('td.noDriver') }) : (c.to ?? t('td.noDriver'))}
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
    </>
  );
}

function UnknownName({ row, day }: { row: Row; day: Day }) {
  const t = useT();
  const router = useRouter();
  const toast = useToast();
  // A name nobody recognised: add the person with the full driver form (under the contractor it mentions), then assign.
  const [newPerson, dialog] = useNewPerson(day.options.contractors, { worksTforce: true, worksHovership: false });
  const hint = day.options.contractors.find((c) => row.rawName!.toLowerCase().includes(c.name.toLowerCase()));
  const add = (contractorId: string | null) => newPerson('', async (d) => {
    const res = await assign({ data: { date: day.date, routeId: row.routeId, payee: { driverId: d.id } } });
    if (!res.ok) return toast(t(`error.${res.code}` as MessageKey));
    toast(t('td.added', { name: d.name, route: row.code }));
    await router.invalidate();
  }, { contractorId });
  return (
    <div className="stack" style={{ gap: 10 }}>
      {dialog}
      <div className="row" style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}>
        <WarningDiamond size={22} />
        <div><strong>{t('td.unknownTitle', { route: row.code })}</strong><span className="sub" style={{ fontSize: 14 }}>{t('td.unknownBody', { name: row.rawName! })}</span></div>
      </div>
      {day.canEdit && (
        <div className="row">
          {hint && <Button variant="primary" onClick={() => add(hint.id)}>{t('td.addUnder', { contractor: hint.name })}</Button>}
          {!hint && <Button onClick={() => add(null)}>{t('td.addOwn')}</Button>}
          <span className="muted" style={{ fontSize: 13.5 }}>{t('td.orPick')}</span>
        </div>
      )}
    </div>
  );
}

/**
 * A new line on the list: the driver code (new, or one taken off earlier), who drives it today and the routes.
 * Saving adds the driver code with that person as its usual driver, confirmed for the day, then its routes.
 */
function TforceRecord({ day, dateLabel, layout, onCancel, focus }: { day: Day; dateLabel: string; layout: 'row' | 'card'; onCancel: () => void; focus?: boolean }) {
  const t = useT();
  const router = useRouter();
  const toast = useToast();
  const [code, setCode] = useState('');
  const [who, setWho] = useState<{ value: string; name?: string } | null>(null);
  const [newPerson, newPersonDialog] = useNewPerson(day.options.contractors, { worksTforce: true, worksHovership: false });
  const [routes, setRoutes] = useState<{ id: string; code: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A code taken off earlier comes back with its usual driver and routes already filled in (still editable).
  const pickCode = (c: string) => {
    setCode(c);
    const off = day.options.offList.find((o) => o.code === c);
    if (off?.usualDriverId && !who) setWho({ value: `d:${off.usualDriverId}` });
    if (off?.usual.length && !routes.length) setRoutes(off.usual);
  };
  const whoName = !who ? null : who.name ?? (who.value.startsWith('d:') ? day.options.drivers.find((d) => d.id === who.value.slice(2))?.name
      : day.options.contractors.find((c) => c.id === who.value.slice(2))?.name);
  // Saves by itself once who works is picked: with a driver code if one was typed, else as a person without
  // code yet (the admin gives it later). A contractor needs a driver code, so it waits for one.
  useEffect(() => { if (who && !busy && (code.trim() || who.value.startsWith('d:'))) void save(); }, [code, who]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = async () => {
    if (!who) return;
    if (!code.trim()) {
      setBusy(true);
      try {
        const res = await addPerson({ data: { date: day.date, driverId: who.value.slice(2), operation: day.operation.code } });
        if (!res.ok) return setError(res.code === 'already_on_list' ? whereOnList(day, who.value.slice(2), t) : t(`error.${res.code}` as MessageKey));
        if (routes.length) await savePersonSortCodes({ data: { executionId: res.value, sortCodeIds: routes.map((x) => x.id) } });
        toast(t('td.personAdded', { name: whoName ?? '' }));
        setWho(null); setRoutes([]); setError(null);
        onCancel(); // saved: the new line is now in the list, so the empty one closes
        await router.invalidate();
      } catch {
        setError(t('error.generic'));
      } finally {
        setBusy(false);
      }
      return;
    }
    const payee = who.value.startsWith('d:') ? { driverId: who.value.slice(2) } : { contractorId: who.value.slice(2) };
    setBusy(true);
    try {
      const res = await createRoute({ data: { date: day.date, code, payee, operation: day.operation.code } });
      if (!res.ok) return setError(t(`error.${res.code}` as MessageKey));
      if (routes.length) {
        const r = await saveSortCodes({ data: { date: day.date, routeId: res.value.routeId, sortCodeIds: routes.map((x) => x.id) } });
        if (!r.ok) toast(t(`error.${r.code}` as MessageKey));
      }
      toast(t('td.recordSaved', { route: res.value.code, name: whoName ?? '' }));
      setCode(''); setWho(null); setRoutes([]); setError(null);
      onCancel();
      await router.invalidate();
    } catch {
      setError(t('error.generic'));
    } finally {
      setBusy(false);
    }
  };
  const allCodes = [...day.options.sortCodes, ...routes.filter((r) => !day.options.sortCodes.some((o) => o.id === r.id))];
  const cells = [
    <PersonPicker key="who" value={who?.value ?? ''} options={day.options} label={t('td.driverFor', { route: code || '…', date: dateLabel })}
      placeholder={who?.name ?? t('td.whoDrives')} allowNone={false}
      onPick={(v) => setWho({ value: v })} onCreate={(name) => newPerson(name, (d) => setWho({ value: `d:${d.id}`, name: d.name }))} />,
    // The driver code: pick one taken off earlier (its usual driver and routes fill in), or type a new one.
    <PersonPicker key="code" value={day.options.offList.some((o) => o.code === code) ? `d:${code}` : ''}
      options={{ drivers: day.options.offList.map((o) => ({ id: o.code, name: o.code })), contractors: [] }}
      label={t('td.routeCode')} placeholder={code || t('td.driverCodePlaceholder')} allowNone={false} createFirst
      createLabel={(typed) => t('td.newDriverCode', { code: typed.toUpperCase().replace(/\s+/g, '') })}
      emptyHint={t('td.driverCodeHint')}
      onPick={(v) => pickCode(v.slice(2))} onCreate={(typed) => setCode(typed.toUpperCase().replace(/\s+/g, ''))} />,

    <SortCodes key="routes" value={routes} options={allCodes} label={t('td.sortCodesFor', { route: code || '…', date: dateLabel })}
      onChange={(ids) => setRoutes(ids.map((id) => allCodes.find((c) => c.id === id)!).filter(Boolean))}
      onCreate={async (typed) => {
        const res = await createSortCodeFromDay({ data: { operation: day.operation.code, code: typed } });
        if (!res.ok) { toast(t(`error.${res.code}` as MessageKey)); return null; }
        setRoutes((rs) => [...rs, { id: res.value.id, code: res.value.code }]);
        return res.value.id;
      }} />,
  ];
  return <>{newPersonDialog}<NewRecord cells={cells} layout={layout} busy={busy} error={error} onCancel={onCancel} focus={focus} /></>;
}

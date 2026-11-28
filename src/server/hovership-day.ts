import { and, asc, desc, eq, inArray, isNotNull, isNull, lt, sql } from 'drizzle-orm';
import type { Tx } from '~/db/client';
import {
  auditLog, drivers, driverUsualSortCodes, exceptions, executionSortCodes, executionView, otherRevenues, payAdjustments, routeExecutions, sortCodes, users, workRecords,
} from '~/db/schema';
import { can } from '~/domain/permissions';
import { todayLA } from '~/domain/dates';
import { assertCan, type Actor } from './actor';
import { audit } from './audit';
import { ledgerByDriver } from './driver-ledger';
import { RuleError } from './errors';
import { payeeIdOf, sortCodesTaken } from './executions';
import { assertNotLocked, operationFor } from './ops';
import { contractorProfiles, createDriver, driverProfiles } from './people';
import { emailDayList, lastSend, listRecipients } from './daily';

// Today's drivers for Hovership: which routes (sort codes) each Hovership driver runs on a day. Hovership's
// report already names the driver, so there is no driver code; Aarisa assigns the routes by hand. It works
// like T-Force's list: each person's usual routes are suggested (status "usual") until someone confirms the
// day or changes them; routes other than the usual ones show as a change, and no routes means off that day.
// A driver-day made here is the same one the weekly report fills, and pays nothing by itself.

// 'covered': off today while someone else runs their usual routes (another driver took their place).
export type HovershipStatus = 'proposed' | 'none' | 'confirmed' | 'changed' | 'off' | 'covered';
type Code = { id: string; code: string };

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));

/** Usual routes per Hovership person (active routes only). */
export async function usualRoutesOf(tx: Tx, driverIds: string[]) {
  const map = new Map<string, Code[]>();
  if (!driverIds.length) return map;
  const rows = await tx.select({ driverId: driverUsualSortCodes.driverId, id: sortCodes.id, code: sortCodes.code })
    .from(driverUsualSortCodes).innerJoin(sortCodes, eq(sortCodes.id, driverUsualSortCodes.sortCodeId))
    .where(and(inArray(driverUsualSortCodes.driverId, driverIds), eq(sortCodes.active, true))).orderBy(asc(sortCodes.code));
  for (const r of rows) map.set(r.driverId, [...(map.get(r.driverId) ?? []), { id: r.id, code: r.code }]);
  return map;
}

async function daysOn(tx: Tx, operationId: string, date: string) {
  return tx.select().from(executionView)
    .where(and(eq(executionView.operationId, operationId), eq(executionView.date, date), eq(executionView.kind, 'route'), isNull(executionView.routeId)));
}

export async function loadHovershipDay(tx: Tx, actor: Actor, date: string, operation?: string) {
  assertCan(actor, 'payroll.view');
  const op = await operationFor(tx, operation, 'report_code');
  const everyone = await driverProfiles(tx, date);
  const days = await daysOn(tx, op.id, date);
  const dayOf = new Map(days.filter((d) => d.payeeDriverId).map((d) => [d.payeeDriverId!, d]));
  // Only people with something saved that day are on its list: a day nobody filled starts empty
  // ("Copy the previous day" fills it).
  const people = everyone.filter((d) => dayOf.has(d.id));
  const ran = days.length ? await tx.select({ executionId: executionSortCodes.executionId, id: sortCodes.id, code: sortCodes.code })
    .from(executionSortCodes).innerJoin(sortCodes, eq(sortCodes.id, executionSortCodes.sortCodeId))
    .where(inArray(executionSortCodes.executionId, days.map((d) => d.id))).orderBy(asc(sortCodes.code)) : [];
  const options = await tx.select({ id: sortCodes.id, code: sortCodes.code }).from(sortCodes)
    .where(and(eq(sortCodes.operationId, op.id), eq(sortCodes.active, true))).orderBy(asc(sortCodes.code));
  const usual = await usualRoutesOf(tx, people.map((p) => p.id));
  const ledger = await ledgerByDriver(tx);

  // Every route change of the day, oldest first: the last one per person says who set the routes and when.
  const log = days.length ? await tx.select({ log: auditLog, user: users.name }).from(auditLog).leftJoin(users, eq(users.id, auditLog.userId))
    .where(and(eq(auditLog.tableName, 'execution_sort_codes'), inArray(auditLog.recordId, days.map((d) => d.id)))).orderBy(asc(auditLog.at)) : [];
  const lastSet = new Map(log.map(({ log: l, user }) => [l.recordId, { at: l.at.toISOString(), user: user ?? null, source: l.source }]));

  const base = people.map((p) => {
    const day = dayOf.get(p.id)!;
    const set = lastSet.get(day.id) ?? null;
    const mine = usual.get(p.id) ?? [];
    const routes = ran.filter((r) => r.executionId === day.id).map(({ id, code }) => ({ id, code }));
    // "Didn't work" is its own status and keeps the person's routes (shown in red, not paid).
    const status: HovershipStatus = day.status === 'off' ? 'off' : day.status === 'proposed' ? 'proposed' : day.status === 'changed' ? 'changed' : 'confirmed';
    return {
      driverId: p.id, name: p.fullName, code: p.hovershipCode, status, usual: mine, setBy: set,
      // "To confirm" routes show dashed, like T-Force.
      sortCodes: routes, suggested: status === 'proposed',
      openNotes: ledger.get(p.id)?.openNotes ?? 0, owedCents: ledger.get(p.id)?.owedCents ?? 0,
    };
  });
  // Who drives each row today: the person, or whoever runs their usual routes while they are off.
  const rows = base.map((r) => {
    const by = r.status === 'off' && r.usual.length
      ? base.find((o) => o.driverId !== r.driverId && o.status !== 'off' && o.sortCodes.some((s) => r.usual.some((u) => u.id === s.id)))
      : undefined;
    return {
      ...r, status: by ? 'covered' as HovershipStatus : r.status,
      today: by ? { driverId: by.driverId, name: by.name } : { driverId: r.driverId, name: r.name },
    };
  });
  // Suggested routes count as taken: a route nobody has is one no one has, even as a suggestion.
  const taken = new Map<string, string[]>();
  for (const r of rows) if (r.status !== 'off' && r.status !== 'covered') for (const s of r.sortCodes) taken.set(s.code, [...(taken.get(s.code) ?? []), r.name]);
  const count = (s: HovershipStatus) => rows.filter((r) => r.status === s).length;

  const name = new Map([...options, ...ran].map((x) => [x.id, x.code]));
  const driverOf = new Map(days.map((d) => [d.id, people.find((p) => p.id === d.payeeDriverId)?.fullName ?? '']));
  return {
    date,
    operation: { code: op.code, name: op.name },
    canEdit: can(actor.role, 'drivers.confirm_today'),
    canLogExtra: can(actor.role, 'extra_jobs.log'),
    rows,
    // People not on the list yet, for "Add driver".
    options: {
      sortCodes: options,
      // Companies for the "New person" form.
      contractors: (await contractorProfiles(tx)).filter((c) => c.active).map((c) => ({ id: c.id, name: c.name })),
      // For "Add driver": people not on this day's list, Hovership ones first.
      others: [...everyone.filter((d) => d.active && d.worksHovership && !dayOf.has(d.id)), ...everyone.filter((d) => d.active && !d.worksHovership && !dayOf.has(d.id))]
        .map((d) => ({ id: d.id, name: d.fullName })),
      // For "Driver today": people on Hovership first, then everyone else (labelled), so nobody is created twice.
      drivers: [...everyone.filter((d) => d.active && d.worksHovership).map((d) => ({ id: d.id, name: d.fullName, contractor: null as string | null })),
        ...everyone.filter((d) => d.active && !d.worksHovership).map((d) => ({ id: d.id, name: d.fullName, contractor: 'T-Force' }))],
    },
    // "Copy the previous day": the last day before this one with a list.
    previous: await (async () => {
      const prev = await previousHovershipDay(tx, op.id, date);
      if (!prev) return null;
      // How many of them aren't on this day yet (what the button would bring).
      const missing = (await daysOn(tx, op.id, prev.date)).filter((d) => d.payeeDriverId && !dayOf.has(d.payeeDriverId)).length;
      return { date: prev.date, missing };
    })(),
    summary: {
      drivers: rows.length,
      working: rows.filter((r) => r.sortCodes.length > 0 && r.status !== 'off').length,
      confirmed: count('confirmed'), changed: count('changed') + count('covered'), proposed: count('proposed'), off: count('off'), none: count('none'),
      // Usual routes confirmed as they were, which "Leave unconfirmed" can take back.
      usualConfirmed: rows.filter((r) => r.status === 'confirmed' && r.usual.length && sameSet(r.sortCodes.map((s) => s.id), r.usual.map((u) => u.id))).length,
      unassigned: options.filter((o) => !taken.has(o.code)).map((o) => o.code),
      shared: [...taken].filter(([, who]) => who.length > 1).map(([code, who]) => ({ code, who })),
    },
    changes: [...log].reverse().map(({ log: l, user }) => ({
      id: l.id, at: l.at.toISOString(), driver: driverOf.get(l.recordId) ?? '', user: user ?? null, source: l.source,
      sortCodes: (((l.after ?? {}) as { sortCodeIds?: string[] }).sortCodeIds ?? []).map((x) => name.get(x) ?? '?'),
    })),
    // The last "Confirm and send list" of this day: who and when.
    sent: await lastSend(tx, op.id, date, hovershipListPeople(rows)),
    recipients: can(actor.role, 'drivers.confirm_today') ? await listRecipients(tx) : [],
  };
}

/**
 * "Confirm and send list" for Hovership: confirms everyone still on their usual routes, then emails who works
 * today (with their code and routes) to the people marked for it in Team access, like T-Force.
 */
/** The Hovership list as it would be sent now (by person). */
function hovershipListPeople(rows: { name: string; code: string | null; status: string; sortCodes: { code: string }[] }[]) {
  return rows.map((r) => ({
    name: r.name, code: r.code ?? '–', routes: r.sortCodes.map((x) => x.code), contractor: false,
    status: (r.status === 'off' || r.status === 'covered' ? 'off' : r.status === 'proposed' || r.status === 'none' ? 'proposed' : 'confirmed') as 'confirmed' | 'proposed' | 'off',
  }));
}

export async function sendHovershipList(tx: Tx, actor: Actor, date: string, operation?: string) {
  assertCan(actor, 'drivers.confirm_today');
  // Sends the list as it is now; confirming is its own button.
  const day = await loadHovershipDay(tx, actor, date, operation);
  const op = await operationFor(tx, operation, 'report_code');
  const people = hovershipListPeople(day.rows);
  const res = await emailDayList(tx, actor, { id: op.id, name: op.name }, date, people, [], '/hovership/today');
  return res;
}

/**
 * The routes a Hovership driver runs on a day, replacing what was there. The usual routes confirm the day,
 * others are a change, none means off. Someone with no usual routes yet keeps these as usual from now on.
 */
export async function setHovershipRoutes(tx: Tx, actor: Actor, input: { date: string; driverId: string; sortCodeIds: string[]; operation?: string }, opts: { skipTaken?: boolean; proposed?: boolean } = {}) {
  assertCan(actor, 'drivers.confirm_today');
  const op = await operationFor(tx, input.operation, 'report_code');
  await assertNotLocked(tx, op, input.date);
  const [person] = await driverProfiles(tx, input.date, [input.driverId]);
  if (!person) throw new RuleError('not_found');
  let wanted = [...new Set(input.sortCodeIds)];
  if (wanted.length) {
    const known = await tx.select({ id: sortCodes.id }).from(sortCodes).where(and(eq(sortCodes.operationId, op.id), inArray(sortCodes.id, wanted)));
    if (known.length !== wanted.length) throw new RuleError('not_found');
  }
  const usual = ((await usualRoutesOf(tx, [person.id])).get(person.id) ?? []).map((u) => u.id);
  const status = opts.proposed ? 'proposed' as const : !wanted.length || !usual.length || sameSet(wanted, usual) ? 'confirmed' as const : 'changed' as const;
  if (!usual.length && wanted.length) await saveUsual(tx, actor, person.id, wanted, []);

  const payeeId = (await payeeIdOf(tx, { driverId: person.id, contractorId: null }))!;
  // A route is run by one person a day: someone else's route is refused (or, when confirming usual routes, left with them).
  const [mine] = await tx.select({ id: routeExecutions.id }).from(routeExecutions).where(and(eq(routeExecutions.operationId, op.id), eq(routeExecutions.date, input.date),
    eq(routeExecutions.payeeId, payeeId), eq(routeExecutions.kind, 'route'), isNull(routeExecutions.routeId)));
  const taken = await sortCodesTaken(tx, op.id, input.date, wanted, mine?.id);
  if (taken.length && !opts.skipTaken) throw new RuleError('route_taken');
  wanted = wanted.filter((x) => !taken.includes(x));
  let [day] = await tx.select().from(routeExecutions).where(and(eq(routeExecutions.operationId, op.id), eq(routeExecutions.date, input.date),
    eq(routeExecutions.payeeId, payeeId), eq(routeExecutions.kind, 'route'), isNull(routeExecutions.routeId)));
  if (!day) {
    [day] = await tx.insert(routeExecutions).values({
      operationId: op.id, date: input.date, kind: 'route', payeeId, driverId: person.id, status, source: actor.source === 'whatsapp' ? 'whatsapp' : 'manual',
      confirmedBy: status === 'proposed' ? null : actor.userId, confirmedAt: status === 'proposed' ? null : new Date(),
    }).returning();
    await audit(tx, { table: 'route_executions', recordId: day!.id, action: 'insert', after: day, userId: actor.userId, source: actor.source });
  } else if (day.status !== status) {
    const [after] = await tx.update(routeExecutions).set({ status, confirmedBy: status === 'proposed' ? null : actor.userId, confirmedAt: status === 'proposed' ? null : new Date(), updatedAt: new Date() }).where(eq(routeExecutions.id, day.id)).returning();
    await audit(tx, { table: 'route_executions', recordId: day.id, action: 'update', before: day, after, userId: actor.userId, source: actor.source });
    day = after;
  }
  const before = (await tx.select({ id: executionSortCodes.sortCodeId }).from(executionSortCodes).where(eq(executionSortCodes.executionId, day!.id))).map((x) => x.id);
  await tx.delete(executionSortCodes).where(eq(executionSortCodes.executionId, day!.id));
  if (wanted.length) await tx.insert(executionSortCodes).values(wanted.map((sortCodeId) => ({ executionId: day!.id, sortCodeId, createdBy: actor.userId })));
  await audit(tx, { table: 'execution_sort_codes', recordId: day!.id, action: 'update', before: { sortCodeIds: before }, after: { sortCodeIds: wanted }, userId: actor.userId, source: actor.source });
  return wanted;
}

/** "Confirm usual": everyone still on their suggested usual routes gets them for the day. */
export async function confirmUsualHovership(tx: Tx, actor: Actor, date: string, operation?: string) {
  assertCan(actor, 'drivers.confirm_today');
  const day = await loadHovershipDay(tx, actor, date, operation);
  const todo = day.rows.filter((r) => r.status === 'proposed');
  for (const r of todo) await setHovershipRoutes(tx, actor, { date, driverId: r.driverId, sortCodeIds: r.sortCodes.map((u) => u.id), operation }, { skipTaken: true });
  return todo.length;
}

/** The last day before `date` with someone on the Hovership list (what "Copy the previous day" copies). */
async function previousHovershipDay(tx: Tx, operationId: string, date: string) {
  const [row] = await tx.select({ date: routeExecutions.date, n: sql<number>`count(*)::int` }).from(routeExecutions)
    .where(and(eq(routeExecutions.operationId, operationId), lt(routeExecutions.date, date), eq(routeExecutions.kind, 'route'), isNull(routeExecutions.routeId), isNotNull(routeExecutions.payeeId)))
    .groupBy(routeExecutions.date).orderBy(desc(routeExecutions.date)).limit(1);
  return row ? { date: row.date, people: row.n } : null;
}

/**
 * "Copy the previous day": everyone on the last day's list comes in with the same routes, to confirm. People
 * already on this day keep their line; a route someone here already runs stays with them.
 */
export async function copyPreviousHovership(tx: Tx, actor: Actor, date: string, operation?: string) {
  assertCan(actor, 'drivers.confirm_today');
  const op = await operationFor(tx, operation, 'report_code');
  await assertNotLocked(tx, op, date);
  const prev = await previousHovershipDay(tx, op.id, date);
  if (!prev) return 0;
  const from = await loadHovershipDay(tx, actor, prev.date, op.code);
  const here = new Set((await daysOn(tx, op.id, date)).map((d) => d.payeeDriverId));
  let n = 0;
  for (const r of from.rows) {
    if (here.has(r.driverId)) continue;
    await setOnHovership(tx, actor, r.driverId, true);
    await setHovershipRoutes(tx, actor, { date, driverId: r.driverId, sortCodeIds: r.sortCodes.map((x) => x.id), operation: op.code }, { skipTaken: true, proposed: true });
    n++;
  }
  return n;
}

/**
 * Back to "usual, not confirmed" for people confirmed on exactly their usual routes; changes and days off
 * stay. Only a day made here goes away: one the report already filled keeps its record.
 */
export async function unconfirmUsualHovership(tx: Tx, actor: Actor, date: string, operation?: string) {
  assertCan(actor, 'drivers.confirm_today');
  const op = await operationFor(tx, operation, 'report_code');
  await assertNotLocked(tx, op, date);
  const day = await loadHovershipDay(tx, actor, date, op.code);
  const back = day.rows.filter((r) => r.status === 'confirmed' && r.usual.length && sameSet(r.sortCodes.map((s) => s.id), r.usual.map((u) => u.id)));
  for (const r of back) await setHovershipRoutes(tx, actor, { date, driverId: r.driverId, sortCodeIds: r.sortCodes.map((x) => x.id), operation: op.code }, { skipTaken: true, proposed: true });
  return back.length;
}

/** A driver-day nothing else points to: no work, extra pay, revenue or exception. */
async function unused(tx: Tx, executionId: string) {
  for (const [table, col] of [[workRecords, workRecords.executionId], [payAdjustments, payAdjustments.executionId], [otherRevenues, otherRevenues.executionId], [exceptions, exceptions.executionId]] as const) {
    const [hit] = await tx.select({ x: col }).from(table).where(eq(col, executionId)).limit(1);
    if (hit) return false;
  }
  return true;
}

/** A Hovership person's usual routes, replacing what was there. */
export async function setHovershipUsual(tx: Tx, actor: Actor, input: { driverId: string; sortCodeIds: string[]; operation?: string }) {
  assertCan(actor, 'setup.edit');
  const op = await operationFor(tx, input.operation, 'report_code');
  const [person] = await driverProfiles(tx, todayLA(), [input.driverId]);
  if (!person) throw new RuleError('not_found');
  const wanted = [...new Set(input.sortCodeIds)];
  if (wanted.length) {
    const known = await tx.select({ id: sortCodes.id }).from(sortCodes).where(and(eq(sortCodes.operationId, op.id), inArray(sortCodes.id, wanted)));
    if (known.length !== wanted.length) throw new RuleError('not_found');
  }
  const before = (await tx.select({ id: driverUsualSortCodes.sortCodeId }).from(driverUsualSortCodes).where(eq(driverUsualSortCodes.driverId, person.id))).map((x) => x.id);
  await saveUsual(tx, actor, person.id, wanted, before);
  return wanted;
}

async function saveUsual(tx: Tx, actor: Actor, driverId: string, wanted: string[], before: string[]) {
  await tx.delete(driverUsualSortCodes).where(eq(driverUsualSortCodes.driverId, driverId));
  if (wanted.length) await tx.insert(driverUsualSortCodes).values(wanted.map((sortCodeId) => ({ driverId, sortCodeId, createdBy: actor.userId })));
  await audit(tx, { table: 'driver_usual_sort_codes', recordId: driverId, action: 'update', before: { sortCodeIds: before }, after: { sortCodeIds: wanted }, userId: actor.userId, source: actor.source });
}

/**
 * Adds someone to Today's drivers for Hovership: a person already in the portal is marked as working on
 * Hovership; a typed name that isn't there yet is created on the spot (marked "Finish setup" for the owner).
 */
export async function addHovershipPerson(tx: Tx, actor: Actor, input: ({ driverId: string } | { newName: string }) & { date?: string }) {
  assertCan(actor, 'drivers.confirm_today');
  if ('newName' in input) {
    const d = await createDriver(tx, actor, {
      fullName: input.newName, contractorId: null, hovershipCode: null, phone: null, aliases: [], active: true, setupComplete: false,
      worksTforce: false, worksHovership: true,
    }, todayLA());
    if (input.date) await putOnDay(tx, actor, input.date, d.id);
    return { driverId: d.id, name: d.fullName, created: true };
  }
  const [person] = await driverProfiles(tx, todayLA(), [input.driverId]);
  if (!person) throw new RuleError('not_found');
  await setOnHovership(tx, actor, person.id, true);
  if (input.date) await putOnDay(tx, actor, input.date, person.id);
  return { driverId: person.id, name: person.fullName, created: false };
}

/** Puts a person on a day's Hovership list (no routes yet) unless they are already on it. */
async function putOnDay(tx: Tx, actor: Actor, date: string, driverId: string) {
  const op = await operationFor(tx, undefined, 'report_code');
  const payeeId = await payeeIdOf(tx, { driverId, contractorId: null });
  if ((await daysOn(tx, op.id, date)).some((d) => d.payeeId === payeeId)) return;
  await setHovershipRoutes(tx, actor, { date, driverId, sortCodeIds: [], operation: op.code });
}

/**
 * The × on a Hovership line: off that day's list only (they stay on Hovership for every other day). Returns what
 * was there, for Undo (restoreHovership).
 */
export async function removeHovershipLine(tx: Tx, actor: Actor, input: { date: string; driverId: string; operation?: string }) {
  assertCan(actor, 'drivers.confirm_today');
  const op = await operationFor(tx, input.operation, 'report_code');
  await assertNotLocked(tx, op, input.date);
  const day = await loadHovershipDay(tx, actor, input.date, op.code);
  const row = day.rows.find((r) => r.driverId === input.driverId);
  if (!row) return null;
  const previous = { driverId: row.driverId, sortCodeIds: row.sortCodes.map((x) => x.id), off: row.status === 'off', proposed: row.status === 'proposed' };
  await restoreHovership(tx, actor, { date: input.date, previous: [{ driverId: row.driverId, sortCodeIds: null }], operation: op.code });
  return previous;
}

/** Takes someone off Today's drivers for Hovership (or puts them back): their platform, not their history. */
export async function setOnHovership(tx: Tx, actor: Actor, driverId: string, on: boolean) {
  assertCan(actor, 'drivers.confirm_today');
  const [before] = await tx.select().from(drivers).where(eq(drivers.id, driverId));
  if (!before) throw new RuleError('not_found');
  if (before.worksHovership === on) return;
  const [after] = await tx.update(drivers).set({ worksHovership: on }).where(eq(drivers.id, driverId)).returning();
  await audit(tx, { table: 'drivers', recordId: driverId, action: 'update', before, after, userId: actor.userId, source: actor.source });
}

/**
 * "Driver today" on a Hovership row: someone else runs this person's routes today. Their routes for the day
 * (the ones set, or else the usual ones) move to the other driver, on top of what that driver already has;
 * this person is off. Picking the person themself again gives them their usual routes back. A typed name
 * that isn't in the portal is created on the spot. Returns what both had before, for Undo.
 */
export async function coverHovership(tx: Tx, actor: Actor, input: { date: string; driverId: string; by: { driverId: string } | { newName: string }; operation?: string }) {
  assertCan(actor, 'drivers.confirm_today');
  const day = await loadHovershipDay(tx, actor, input.date, input.operation);
  const row = day.rows.find((r) => r.driverId === input.driverId);
  if (!row) throw new RuleError('not_found');
  const byId = 'newName' in input.by ? (await addHovershipPerson(tx, actor, input.by)).driverId : input.by.driverId;
  const routesOf = (id: string) => day.rows.find((r) => r.driverId === id)?.sortCodes.map((s) => s.id) ?? [];
  const was = (id: string) => day.rows.find((r) => r.driverId === id);
  const previous: { driverId: string; sortCodeIds: string[] | null; off?: boolean; proposed?: boolean }[] = [
    { driverId: row.driverId, sortCodeIds: routesOf(row.driverId), off: row.status === 'off', proposed: row.status === 'proposed' },
    // Someone who wasn't on the day's list goes back off it.
    ...(byId !== row.driverId ? [{ driverId: byId, sortCodeIds: was(byId) ? routesOf(byId) : null, proposed: was(byId)?.status === 'proposed' }] : []),
  ];
  if (byId === row.driverId) {
    // Back to the person: their usual routes, taken from whoever had them.
    const usual = row.usual.map((u) => u.id);
    for (const o of day.rows) {
      if (o.driverId === row.driverId) continue;
      const mine = o.sortCodes.map((s) => s.id);
      if (mine.some((x) => usual.includes(x))) {
        previous.push({ driverId: o.driverId, sortCodeIds: mine });
        await setHovershipRoutes(tx, actor, { date: input.date, driverId: o.driverId, sortCodeIds: mine.filter((x) => !usual.includes(x)), operation: input.operation });
      }
    }
    await setHovershipRoutes(tx, actor, { date: input.date, driverId: row.driverId, sortCodeIds: usual, operation: input.operation });
    return { name: row.name, previous };
  }
  const moving = row.status === 'covered' ? row.usual.map((u) => u.id) : row.sortCodes.map((s) => s.id);
  if (!moving.length) throw new RuleError('no_routes_to_cover');
  await setOnHovership(tx, actor, byId, true);
  const other = day.rows.find((r) => r.driverId === byId);
  const has = other ? other.sortCodes.map((s) => s.id) : [];
  // The routes leave whoever runs them now (the person, or someone covering them before), then go to the new person:
  // a route is never on two people at once.
  await setHovershipRoutes(tx, actor, { date: input.date, driverId: row.driverId, sortCodeIds: [], operation: input.operation });
  await markHovershipOff(tx, actor, (await operationFor(tx, input.operation, 'report_code')).id, input.date, row.driverId);
  for (const o of day.rows) {
    if (o.driverId === row.driverId || o.driverId === byId) continue;
    const mine = o.sortCodes.map((x) => x.id);
    if (mine.some((x) => moving.includes(x))) {
      previous.push({ driverId: o.driverId, sortCodeIds: mine });
      await setHovershipRoutes(tx, actor, { date: input.date, driverId: o.driverId, sortCodeIds: mine.filter((x) => !moving.includes(x)), operation: input.operation });
    }
  }
  await setHovershipRoutes(tx, actor, { date: input.date, driverId: byId, sortCodeIds: [...new Set([...has, ...moving])], operation: input.operation }, { skipTaken: true });
  const [who] = await driverProfiles(tx, input.date, [byId]);
  return { name: who?.fullName ?? '', previous };
}

/** Undo for "Driver today": each person back to the routes they had (or to their suggestion). */
export async function restoreHovership(tx: Tx, actor: Actor, input: { date: string; previous: { driverId: string; sortCodeIds: string[] | null; off?: boolean; proposed?: boolean }[]; operation?: string }) {
  assertCan(actor, 'drivers.confirm_today');
  const op = await operationFor(tx, input.operation, 'report_code');
  // First everyone lets go of their routes today, so each one gets back exactly what they had (a route can't be on two people).
  if (input.previous.length > 1) {
    const here = new Set((await daysOn(tx, op.id, input.date)).map((d) => d.payeeDriverId));
    for (const p of input.previous) if (here.has(p.driverId)) {
      const payeeId = (await payeeIdOf(tx, { driverId: p.driverId, contractorId: null }))!;
      const [row] = await tx.select().from(routeExecutions).where(and(eq(routeExecutions.operationId, op.id), eq(routeExecutions.date, input.date),
        eq(routeExecutions.payeeId, payeeId), eq(routeExecutions.kind, 'route'), isNull(routeExecutions.routeId)));
      if (!row) continue;
      const had = (await tx.select({ id: executionSortCodes.sortCodeId }).from(executionSortCodes).where(eq(executionSortCodes.executionId, row.id))).map((x) => x.id);
      await tx.delete(executionSortCodes).where(eq(executionSortCodes.executionId, row.id));
      await audit(tx, { table: 'execution_sort_codes', recordId: row.id, action: 'undo', before: { sortCodeIds: had }, after: { sortCodeIds: [] }, userId: actor.userId, source: actor.source });
    }
  }
  for (const p of input.previous) {
    if (p.sortCodeIds) {
      await setHovershipRoutes(tx, actor, { date: input.date, driverId: p.driverId, sortCodeIds: p.sortCodeIds, operation: op.code }, { skipTaken: true, proposed: p.proposed });
      if (p.off) await markHovershipOff(tx, actor, op.id, input.date, p.driverId);
      continue;
    }
    // They weren't on the day's list: drop the day made here, if nothing else depends on it.
    const payeeId = (await payeeIdOf(tx, { driverId: p.driverId, contractorId: null }))!;
    const [row] = await tx.select().from(routeExecutions).where(and(eq(routeExecutions.operationId, op.id), eq(routeExecutions.date, input.date),
      eq(routeExecutions.payeeId, payeeId), eq(routeExecutions.kind, 'route'), isNull(routeExecutions.routeId)));
    if (!row || row.importId || !(await unused(tx, row.id))) continue;
    const codes = (await tx.select({ id: executionSortCodes.sortCodeId }).from(executionSortCodes).where(eq(executionSortCodes.executionId, row.id))).map((x) => x.id);
    await tx.delete(executionSortCodes).where(eq(executionSortCodes.executionId, row.id));
    await audit(tx, { table: 'execution_sort_codes', recordId: row.id, action: 'undo', before: { sortCodeIds: codes }, userId: actor.userId, source: actor.source });
    await tx.delete(routeExecutions).where(eq(routeExecutions.id, row.id));
    await audit(tx, { table: 'route_executions', recordId: row.id, action: 'undo', before: row, userId: actor.userId, source: actor.source });
  }
}

export type HovershipRowStatus = 'confirmed' | 'proposed' | 'off';

/**
 * The status chosen on a Hovership line: Confirmed (their routes, or none yet), To confirm (back to the suggestion),
 * Didn't work (the person and routes stay on the line in red; the routes are free for whoever covers them).
 */
export async function setHovershipStatus(tx: Tx, actor: Actor, input: { date: string; driverId: string; status: HovershipRowStatus; operation?: string }) {
  assertCan(actor, 'drivers.confirm_today');
  const op = await operationFor(tx, input.operation, 'report_code');
  await assertNotLocked(tx, op, input.date);
  const day = await loadHovershipDay(tx, actor, input.date, op.code);
  const row = day.rows.find((r) => r.driverId === input.driverId);
  if (!row) throw new RuleError('not_found');
  const routes = (row.status === 'covered' ? row.usual : row.sortCodes).map((x) => x.id);
  if (input.status === 'proposed') {
    await setHovershipRoutes(tx, actor, { date: input.date, driverId: input.driverId, sortCodeIds: routes, operation: op.code }, { skipTaken: true, proposed: true });
    return;
  }
  // Saving the routes makes the day confirmed (or changed); "didn't work" then marks it.
  await setHovershipRoutes(tx, actor, { date: input.date, driverId: input.driverId, sortCodeIds: routes, operation: op.code }, { skipTaken: true });
  if (input.status === 'off') await markHovershipOff(tx, actor, op.id, input.date, input.driverId);
}

async function markHovershipOff(tx: Tx, actor: Actor, operationId: string, date: string, driverId: string) {
  const payeeId = (await payeeIdOf(tx, { driverId, contractorId: null }))!;
  const [row] = await tx.select().from(routeExecutions).where(and(eq(routeExecutions.operationId, operationId), eq(routeExecutions.date, date),
    eq(routeExecutions.payeeId, payeeId), eq(routeExecutions.kind, 'route'), isNull(routeExecutions.routeId)));
  if (!row || row.status === 'off') return;
  const [after] = await tx.update(routeExecutions).set({ status: 'off', confirmedBy: null, confirmedAt: null, updatedAt: new Date() }).where(eq(routeExecutions.id, row.id)).returning();
  await audit(tx, { table: 'route_executions', recordId: row.id, action: 'update', before: row, after, userId: actor.userId, source: actor.source });
}

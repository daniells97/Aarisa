import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';
import type { Tx } from '~/db/client';
import { auditLog, contractors, dayListSends, drivers, executionSortCodes, executionView, routeExecutions, routes, sortCodes, users } from '~/db/schema';
import { todayLA } from '~/domain/dates';
import { can } from '~/domain/permissions';
import { assertCan, type Actor } from './actor';
import { audit } from './audit';
import { RuleError } from './errors';
import { assertNotLocked, getOperationById, operationFor } from './ops';
import { payeeIdOf, payeeNamesById, routeDay, writeRouteDay } from './executions';
import { contractorProfiles, createDriver, createRoute, driverProfiles, routeOwners, type DriverInput } from './people';
import { usualSortCodes } from './sort-codes';
import { dayListEmail, type DayListPerson } from './emails';
import { sendMail } from '~/integrations/mail';
import { isLocale } from '~/i18n';

// Today's drivers (spec 6.3): who drove each T-Force route each day. No money here.

export type PayeeInput = { driverId: string } | { contractorId: string } | null;
// 'off': the driver code didn't run that day (no one is paid, no exception if T-Force reports nothing).
export type DayStatus = 'proposed' | 'confirmed' | 'changed' | 'waiting' | 'no_driver' | 'off';

const samePayee = (a: { driverId: string | null; contractorId: string | null }, b: { driverId: string | null; contractorId: string | null }) =>
  a.driverId === b.driverId && a.contractorId === b.contractorId;

function payeeCols(p: PayeeInput) {
  return { driverId: p && 'driverId' in p ? p.driverId : null, contractorId: p && 'contractorId' in p ? p.contractorId : null };
}

/** Usual payee of a route: its owner if a contractor owns it that day, else its usual driver. */
function usualOf(r: typeof routes.$inferSelect, owner: string | null) {
  return owner ? { driverId: null, contractorId: owner } : { driverId: r.usualDriverId, contractorId: null };
}

async function ownerOn(tx: Tx, routeId: string, date: string) {
  return (await routeOwners(tx, date, [routeId])).get(routeId) ?? null;
}

export async function loadDay(tx: Tx, actor: Actor, date: string, operation?: string) {
  assertCan(actor, 'payroll.view');
  const op = await operationFor(tx, operation, 'daily_list');
  const routeRows = await tx.select().from(routes).where(and(eq(routes.operationId, op.id), eq(routes.active, true))).orderBy(asc(routes.code));
  const assignments = (routeRows.length
    ? await tx.select().from(executionView).where(and(eq(executionView.operationId, op.id), eq(executionView.date, date), eq(executionView.kind, 'route'), inArray(executionView.routeId, routeRows.map((r) => r.id))))
    : []).map((a) => ({ ...a, routeId: a.routeId!, driverId: a.payeeDriverId, contractorId: a.payeeContractorId }));
  const owners = await routeOwners(tx, date, routeRows.map((r) => r.id));
  // The sort codes (routes) each driver code ran that day.
  const ran = assignments.length ? await tx.select({ executionId: executionSortCodes.executionId, id: sortCodes.id, code: sortCodes.code })
    .from(executionSortCodes).innerJoin(sortCodes, eq(sortCodes.id, executionSortCodes.sortCodeId))
    .where(inArray(executionSortCodes.executionId, assignments.map((a) => a.id))).orderBy(asc(sortCodes.code)) : [];
  const usualRoutes = await usualSortCodes(tx, routeRows.map((r) => r.id));
  const routesSet = await sortCodesSetOn(tx, assignments.map((a) => a.id));
  const sortCodeOptions = await tx.select({ id: sortCodes.id, code: sortCodes.code }).from(sortCodes)
    .where(and(eq(sortCodes.operationId, op.id), eq(sortCodes.active, true))).orderBy(asc(sortCodes.code));
  const driverRows = await driverProfiles(tx, date);
  const contractorRows = (await contractorProfiles(tx)).filter((c) => c.active).map((c) => ({ id: c.id, name: c.name }));
  const dName = new Map(driverRows.map((d) => [d.id, d.fullName]));
  const cName = new Map(contractorRows.map((c) => [c.id, c.name]));
  const label = (p: { driverId: string | null; contractorId: string | null }) =>
    p.driverId ? dName.get(p.driverId) ?? '' : p.contractorId ? cName.get(p.contractorId) ?? '' : null;

  const codeRows = routeRows.map((r) => {
    const a = assignments.find((x) => x.routeId === r.id);
    const owner = owners.get(r.id) ?? null;
    const usual = usualOf(r, owner);
    const today = a ? { driverId: a.driverId, contractorId: a.contractorId } : usual;
    const status: DayStatus = a ? a.status : usual.driverId || usual.contractorId ? 'proposed' : 'no_driver';
    return {
      routeId: r.id, code: r.code, contractorRoute: !!owner,
      usual: { ...usual, name: label(usual) },
      today: { ...today, name: label(today) },
      rawName: a?.rawName ?? null,
      // The day's routes once someone set them (or confirmed the day); before that, the usual ones as a suggestion.
      ...(a && routesSet.has(a.id)
        ? { sortCodes: ran.filter((x) => x.executionId === a.id).map(({ id, code }) => ({ id, code })), sortCodesSuggested: false }
        : { sortCodes: usualRoutes.get(r.id) ?? [], sortCodesSuggested: (usualRoutes.get(r.id) ?? []).length > 0 }),
      status,
      source: a?.source ?? null,
      assignmentId: a?.id ?? null,
      updatedAt: a?.updatedAt.toISOString() ?? null,
    };
  });
  // People confirmed for the day who don't have a driver code yet (the admin gives them one).
  const noCode = (await peopleWithoutCode(tx, op.id, date)).map((p) => ({
    executionId: p.id, driverId: p.payeeDriverId!, name: label({ driverId: p.payeeDriverId, contractorId: null }) ?? '',
    sortCodes: p.sortCodes, status: (p.status === 'changed' ? 'changed' : 'confirmed') as DayStatus, updatedAt: p.updatedAt.toISOString(),
  }));
  // Person first: the list reads by who works, then their driver code. Codes nobody drives go last.
  const empty = (r: typeof codeRows[number]) => !r.today.name || r.status === 'off' || r.status === 'no_driver';
  const rows = codeRows.sort((a, b) => Number(empty(a)) - Number(empty(b))
    || (a.today.name ?? '').localeCompare(b.today.name ?? '') || a.code.localeCompare(b.code));

  // Today's change log: audit entries for this day's executions, newest first. Executions kept the ids of
  // the daily assignments they replaced, so older entries (logged as daily_assignments) still show.
  const ids = assignments.map((a) => a.id);
  const log = ids.length ? await tx.select({ log: auditLog, user: users.name }).from(auditLog).leftJoin(users, eq(users.id, auditLog.userId))
    .where(and(inArray(auditLog.tableName, ['route_executions', 'daily_assignments', 'execution_sort_codes']), inArray(auditLog.recordId, ids))).orderBy(desc(auditLog.at)).limit(50) : [];
  type Logged = { payeeId?: string | null; driverId?: string | null; contractorId?: string | null; rawName?: string | null };
  const logged = log.flatMap(({ log: l }) => [l.before, l.after] as (Logged | null)[]);
  const payeeName = await payeeNamesById(tx, [...new Set(logged.map((x) => x?.payeeId).filter((x): x is string => !!x))]);
  const nameOf = (x: Logged) => x.payeeId !== undefined ? (x.payeeId ? payeeName.get(x.payeeId) ?? '' : null)
    : label({ driverId: x.driverId ?? null, contractorId: x.contractorId ?? null });
  const routeOf = new Map(assignments.map((a) => [a.id, routeRows.find((r) => r.id === a.routeId)?.code ?? '']));
  const sortCodeName = new Map([...sortCodeOptions, ...ran].map((x) => [x.id, x.code]));
  // A record created only to hold routes (still the usual driver, not confirmed) isn't a change of driver.
  // Nor are the usual routes saved when the day is confirmed.
  const shown = log.filter(({ log: l }) => !(l.tableName === 'route_executions' && l.action === 'insert' && (l.after as { status?: string } | null)?.status === 'proposed')
    && !(l.tableName === 'execution_sort_codes' && l.action === 'insert'));
  const changes = shown.map(({ log: l, user }) => {
    const af = (l.after ?? {}) as Logged & { sortCodeIds?: string[] };
    const base = { id: l.id, at: l.at.toISOString(), route: routeOf.get(l.recordId) ?? '', action: l.action, source: l.source, user: user ?? null };
    // A change of the routes (sort codes) a driver ran, not of who drove.
    if (l.tableName === 'execution_sort_codes') return { ...base, from: null, to: null, sortCodes: (af.sortCodeIds ?? []).map((x) => sortCodeName.get(x) ?? '?'), off: false };
    return { ...base, from: l.before ? nameOf(l.before as Logged) : null, to: nameOf(af) ?? af.rawName ?? null, sortCodes: null, off: (af as { status?: string }).status === 'off' };
  });

  const count = (s: DayStatus | 'contractor') => codeRows.filter((r) => (s === 'contractor' ? r.contractorRoute && r.status !== 'no_driver' : !r.contractorRoute && r.status === s)).length;
  const first = await operationFor(tx, undefined, 'daily_list');
  // Driver codes taken off the list: picking one in a new record brings it back with its usual driver and routes.
  const offRows = await tx.select().from(routes).where(and(eq(routes.operationId, op.id), eq(routes.active, false))).orderBy(asc(routes.code));
  const offUsual = await usualSortCodes(tx, offRows.map((r) => r.id));
  const offList = offRows.map((r) => ({ code: r.code, usualDriverId: r.usualDriverId, usual: offUsual.get(r.id) ?? [] }));

  return {
    date,
    operation: { code: op.code, name: op.name, isDefault: op.code === first.code },
    canEdit: can(actor.role, 'drivers.confirm_today'),
    rows,
    noCode,
    summary: {
      routes: codeRows.length,
      people: rows.filter((r) => !empty(r)).length + noCode.length,
      noCode: noCode.length,
      confirmed: count('confirmed') + count('changed'),
      proposed: count('proposed'),
      // Confirmed on the usual payee: what "Mark as not confirmed" takes back.
      usualConfirmed: codeRows.filter((r) => r.status === 'confirmed' && samePayee(r.today, r.usual)).length,
      contractor: count('contractor'),
      waiting: count('waiting'),
      noDriver: codeRows.filter((r) => r.status === 'no_driver').length,
      off: codeRows.filter((r) => r.status === 'off').length,
    },
    options: {
      // People on T-Force first (Drivers and rates → Platform); the rest can still be picked, labelled with their
      // platform, so nobody gets created twice. Picking one of them puts them on T-Force too.
      drivers: [...driverRows.filter((d) => d.active && d.worksTforce), ...driverRows.filter((d) => d.active && !d.worksTforce)]
        .map((d) => ({ id: d.id, name: d.fullName, contractor: d.contractorId ? cName.get(d.contractorId) ?? null : d.worksTforce ? null : 'Hovership' })),
      contractors: contractorRows,
      sortCodes: sortCodeOptions,
      // Driver codes taken off the list: typing one in a new record brings it back with its history.
      offList,
    },
    changes,
    // One driver put on two or more driver codes the same day: allowed (it happens), but worth a second look.
    // Someone who is the usual driver of two codes isn't flagged until a change puts them on another one.
    doubles: [...rows.filter((r) => r.today.driverId && !r.contractorRoute && (r.status === 'confirmed' || r.status === 'changed' || r.status === 'proposed'))
      .reduce((m, r) => m.set(r.today.driverId!, [...(m.get(r.today.driverId!) ?? []), r]), new Map<string, typeof rows>())]
      .filter(([, rs]) => rs.length > 1 && rs.some((r) => r.status === 'changed')).map(([, rs]) => ({ name: rs[0]!.today.name ?? '', codes: rs.map((r) => r.code) })),
    // The last "Confirm and send list" of this day: who and when.
    sent: await lastSend(tx, op.id, date),
  };
}

async function lastSend(tx: Tx, operationId: string, date: string) {
  const [row] = await tx.select({ at: dayListSends.sentAt, by: users.name, recipients: dayListSends.recipients }).from(dayListSends)
    .leftJoin(users, eq(users.id, dayListSends.sentBy))
    .where(and(eq(dayListSends.operationId, operationId), eq(dayListSends.date, date))).orderBy(desc(dayListSends.sentAt)).limit(1);
  return row ? { at: row.at.toISOString(), by: row.by ?? null, recipients: row.recipients } : null;
}

async function writeAssignment(tx: Tx, actor: Actor, date: string, routeId: string, values: {
  driverId: string | null; contractorId: string | null; rawName?: string | null; status: DayStatus;
}, action: 'insert' | 'update' | 'undo' = 'update') {
  const [route] = await tx.select().from(routes).where(eq(routes.id, routeId));
  if (!route) throw new RuleError('not_found');
  const op = await getOperationById(tx, route.operationId);
  if (op.driverSource !== 'daily_list') throw new RuleError('not_found');
  await assertNotLocked(tx, op, date);
  if (values.driverId) {
    const [d] = await tx.select({ id: drivers.id }).from(drivers).where(eq(drivers.id, values.driverId));
    if (!d) throw new RuleError('not_found');
  }
  if (values.contractorId) {
    const [c] = await tx.select({ id: contractors.id }).from(contractors).where(eq(contractors.id, values.contractorId));
    if (!c) throw new RuleError('not_found');
  }
  const source = actor.source === 'whatsapp' ? 'whatsapp' as const : actor.source === 'system' ? 'system' as const : 'manual' as const;
  const view = await routeDay(tx, op.id, date, routeId);
  // Someone on the day without a driver code who is now put on a code: one line for them, not two.
  // Their routes come along when the code has none set yet.
  let carried: string[] = [];
  if (values.driverId && (values.status === 'confirmed' || values.status === 'changed')) {
    const [loose] = await tx.select().from(routeExecutions).where(and(eq(routeExecutions.operationId, op.id), eq(routeExecutions.date, date),
      eq(routeExecutions.kind, 'route'), isNull(routeExecutions.routeId), eq(routeExecutions.driverId, values.driverId)));
    if (loose) {
      carried = (await tx.select().from(executionSortCodes).where(eq(executionSortCodes.executionId, loose.id))).map((x) => x.sortCodeId);
      await dropPersonRow(tx, actor, loose);
    }
  }
  const { before, after } = await writeRouteDay(tx, {
    operationId: op.id, date, routeId, payee: { driverId: values.driverId, contractorId: values.contractorId }, rawName: values.rawName ?? null,
    status: values.status, source, userId: actor.userId,
  });
  await audit(tx, { table: 'route_executions', recordId: after.id, action: before ? action : 'insert', before, after, userId: actor.userId, source: actor.source });
  if (carried.length && !(await sortCodesSetOn(tx, [after.id])).size) await replaceSortCodes(tx, actor, op.id, after.id, carried);
  if (values.status === 'confirmed' || values.status === 'changed') await keepUsualSortCodes(tx, actor, after.id, routeId);
  // Callers undo to the previous driver or contractor, so hand back that shape.
  const previous = view ? { driverId: view.payeeDriverId, contractorId: view.payeeContractorId, rawName: view.rawName, status: view.status } : null;
  return { before: previous, after };
}

/**
 * "Didn't run today": the driver code stays on the list, but this day nobody drove it, so T-Force reporting
 * nothing for it is expected (no exception). Its routes that day are cleared. Undo with undoAssignment.
 */
export async function markOffToday(tx: Tx, actor: Actor, input: { date: string; routeId: string }) {
  assertCan(actor, 'drivers.confirm_today');
  const { before, after } = await writeAssignment(tx, actor, input.date, input.routeId, { driverId: null, contractorId: null, rawName: null, status: 'off' });
  const had = await tx.select().from(executionSortCodes).where(eq(executionSortCodes.executionId, after.id));
  if (had.length) {
    await tx.delete(executionSortCodes).where(eq(executionSortCodes.executionId, after.id));
    await audit(tx, had.map((h) => ({ table: 'execution_sort_codes', recordId: after.id, action: 'delete' as const, before: h, userId: actor.userId, source: actor.source })));
  }
  return { assignmentId: after.id, previous: before };
}

/** Sets who drove a route on a day. Same as the usual payee → confirmed; different → changed; nobody → no driver. */
export async function setAssignment(tx: Tx, actor: Actor, input: { date: string; routeId: string; payee: PayeeInput }) {
  assertCan(actor, 'drivers.confirm_today');
  return assignRoute(tx, actor, input);
}

/**
 * Same as setAssignment without its permission check, for callers that already checked a
 * permission that covers it (resolving a weekly-check exception needs exceptions.clear).
 */
export async function assignRoute(tx: Tx, actor: Actor, input: { date: string; routeId: string; payee: PayeeInput }) {
  const [route] = await tx.select().from(routes).where(eq(routes.id, input.routeId));
  if (!route) throw new RuleError('not_found');
  const cols = payeeCols(input.payee);
  if (cols.driverId) await putOnTforce(tx, actor, cols.driverId);
  const usual = usualOf(route, await ownerOn(tx, route.id, input.date));
  const status: DayStatus = !cols.driverId && !cols.contractorId ? 'no_driver' : samePayee(cols, usual) ? 'confirmed' : 'changed';
  const { before, after } = await writeAssignment(tx, actor, input.date, input.routeId, { ...cols, status });
  return { assignmentId: after.id, previous: before ? { driverId: before.driverId, contractorId: before.contractorId, rawName: before.rawName, status: before.status } : null };
}

/** Undo from the toast: writes the previous values back as a new change (history is never deleted). */
export async function undoAssignment(tx: Tx, actor: Actor, input: {
  date: string; routeId: string; previous: { driverId: string | null; contractorId: string | null; rawName: string | null; status: DayStatus } | null;
}) {
  assertCan(actor, 'drivers.confirm_today');
  const [route] = await tx.select().from(routes).where(eq(routes.id, input.routeId));
  if (!route) throw new RuleError('not_found');
  const values = input.previous ?? { ...usualOf(route, await ownerOn(tx, route.id, input.date)), rawName: null, status: 'proposed' as const };
  await writeAssignment(tx, actor, input.date, input.routeId, values, 'undo');
}

/** "All good": confirms every route still on its proposed usual payee. */
export async function confirmUsual(tx: Tx, actor: Actor, date: string, operation?: string) {
  assertCan(actor, 'drivers.confirm_today');
  const day = await loadDay(tx, actor, date, operation);
  let n = 0;
  for (const r of day.rows) {
    if (r.status !== 'proposed') continue;
    await writeAssignment(tx, actor, date, r.routeId, { driverId: r.usual.driverId, contractorId: r.usual.contractorId, status: 'confirmed' });
    n++;
  }
  return n;
}

/**
 * Takes back "Confirm usual drivers": routes confirmed on their usual payee go back to proposed. Routes
 * someone changed, left without a driver or is waiting on keep their state; each row is audited as an undo.
 */
export async function unconfirmUsual(tx: Tx, actor: Actor, date: string, operation?: string) {
  assertCan(actor, 'drivers.confirm_today');
  const day = await loadDay(tx, actor, date, operation);
  let n = 0;
  for (const r of day.rows) {
    if (r.status !== 'confirmed' || !samePayee(r.today, r.usual)) continue;
    await writeAssignment(tx, actor, date, r.routeId, { driverId: r.usual.driverId, contractorId: r.usual.contractorId, status: 'proposed' }, 'undo');
    n++;
  }
  return n;
}

/**
 * A new person from Daily operations, with the same form as Drivers and rates (name, phone, email, address,
 * license, emergency contact…). Fully set up, so it isn't marked "Finish setup".
 */
export async function addDriverFromToday(tx: Tx, actor: Actor, input: DriverInput) {
  assertCan(actor, 'drivers.confirm_today');
  return createDriver(tx, actor, { ...input, setupComplete: true }, todayLA());
}

/** A name nobody recognised ("the new guy from Puma"): add the person under a contractor and assign them. */
export async function addDriverForRoute(tx: Tx, actor: Actor, input: { date: string; routeId: string; fullName: string; contractorId: string | null }) {
  assertCan(actor, 'drivers.confirm_today');
  const d = await createQuickDriver(tx, actor, input.fullName, input.contractorId);
  await setAssignment(tx, actor, { date: input.date, routeId: input.routeId, payee: { driverId: d.id } });
  return d;
}

/**
 * A driver typed in Today's drivers who isn't on the list yet. Marked "Finish setup" so the owner adds
 * phone, codes and aliases later. Refuses a name that already exists, so the list doesn't get duplicates.
 */
async function createQuickDriver(tx: Tx, actor: Actor, fullName: string, contractorId: string | null) {
  return createDriver(tx, actor, { fullName, contractorId, hovershipCode: null, phone: null, aliases: [], active: true, setupComplete: false }, todayLA());
}

export type NewRoutePayee = { driverId: string } | { contractorId: string } | { newDriverName: string };

/**
 * A route that isn't on the list yet (spec 6.3, decision of Oct 9, 2026). The person who drives it becomes
 * its usual driver; a contractor makes it a contractor route. It is assigned and confirmed for the day.
 */
export async function addRoute(tx: Tx, actor: Actor, input: { date: string; code: string; payee: NewRoutePayee; operation?: string }) {
  assertCan(actor, 'drivers.confirm_today');
  const code = input.code.trim().toUpperCase().replace(/\s+/g, '');
  if (!/^[A-Z0-9-]{2,12}$/.test(code)) throw new RuleError('route_code_invalid');
  const op = await operationFor(tx, input.operation, 'daily_list');
  await assertNotLocked(tx, op, input.date);
  const [clash] = await tx.select().from(routes).where(and(eq(routes.operationId, op.id), eq(routes.code, code)));
  if (clash?.active) throw new RuleError('route_exists');

  let payee: { driverId: string } | { contractorId: string };
  if ('newDriverName' in input.payee) payee = { driverId: (await createQuickDriver(tx, actor, input.payee.newDriverName, null)).id };
  else payee = input.payee;
  const cols = payeeCols(payee);
  if (cols.driverId && !(await tx.select({ id: drivers.id }).from(drivers).where(eq(drivers.id, cols.driverId))).length) throw new RuleError('not_found');
  if (cols.driverId) await putOnTforce(tx, actor, cols.driverId);
  if (cols.contractorId && !(await tx.select({ id: contractors.id }).from(contractors).where(eq(contractors.id, cols.contractorId))).length) throw new RuleError('not_found');

  // A driver code taken off the list earlier comes back with its history; the person becomes its usual driver.
  const route = clash ? await reactivate(tx, actor, clash, cols.driverId) : await createRoute(tx, actor, { operationId: op.id, code, contractorId: cols.contractorId, usualDriverId: cols.driverId });
  await writeAssignment(tx, actor, input.date, route.id, { ...cols, status: 'confirmed' });
  return route;
}

/** Someone given a T-Force driver code works on T-Force from now on (Drivers and rates → Platform). */
async function putOnTforce(tx: Tx, actor: Actor, driverId: string) {
  const [before] = await tx.select().from(drivers).where(eq(drivers.id, driverId));
  if (!before || before.worksTforce) return;
  const [after] = await tx.update(drivers).set({ worksTforce: true }).where(eq(drivers.id, driverId)).returning();
  await audit(tx, { table: 'drivers', recordId: driverId, action: 'update', before, after, userId: actor.userId, source: actor.source });
}

async function reactivate(tx: Tx, actor: Actor, before: typeof routes.$inferSelect, usualDriverId: string | null) {
  const [after] = await tx.update(routes).set({ active: true, ...(usualDriverId ? { usualDriverId } : {}) }).where(eq(routes.id, before.id)).returning();
  await audit(tx, { table: 'routes', recordId: before.id, action: 'update', before, after, userId: actor.userId, source: actor.source });
  return after!;
}

/**
 * Takes a driver code off Today's drivers from now on (it can be added back with "Add driver", or undone).
 * Days already worked keep it; that day's assignment, if any, is left as it was.
 */
export async function setRouteOnList(tx: Tx, actor: Actor, input: { routeId: string; active: boolean }) {
  assertCan(actor, 'drivers.confirm_today');
  const [before] = await tx.select().from(routes).where(eq(routes.id, input.routeId));
  if (!before) throw new RuleError('not_found');
  if (before.active === input.active) return before;
  const [after] = await tx.update(routes).set({ active: input.active }).where(eq(routes.id, before.id)).returning();
  await audit(tx, { table: 'routes', recordId: before.id, action: 'update', before, after, userId: actor.userId, source: actor.source });
  return after!;
}

/** Assigns someone typed in the driver picker who isn't on the list: creates them, then assigns. */
export async function assignNewDriver(tx: Tx, actor: Actor, input: { date: string; routeId: string; fullName: string }) {
  assertCan(actor, 'drivers.confirm_today');
  const d = await createQuickDriver(tx, actor, input.fullName, null);
  const res = await setAssignment(tx, actor, { date: input.date, routeId: input.routeId, payee: { driverId: d.id } });
  return { driver: d, ...res };
}

/** Records an unrecognised name on a route (from the daily list or WhatsApp), leaving it without a driver. */
export async function setUnknownName(tx: Tx, actor: Actor, input: { date: string; routeId: string; rawName: string }) {
  assertCan(actor, 'drivers.confirm_today');
  await writeAssignment(tx, actor, input.date, input.routeId, { driverId: null, contractorId: null, rawName: input.rawName, status: 'no_driver' });
}

/**
 * The sort codes (routes) a driver code ran on a day, replacing what was there ("add another" adds one,
 * the chip's × takes one off). A day without a record yet gets one with its usual driver, still proposed.
 */
export async function setSortCodes(tx: Tx, actor: Actor, input: { date: string; routeId: string; sortCodeIds: string[] }) {
  assertCan(actor, 'drivers.confirm_today');
  const [route] = await tx.select().from(routes).where(eq(routes.id, input.routeId));
  if (!route) throw new RuleError('not_found');
  const op = await getOperationById(tx, route.operationId);
  await assertNotLocked(tx, op, input.date);
  const wanted = [...new Set(input.sortCodeIds)];
  if (wanted.length) {
    const known = await tx.select({ id: sortCodes.id }).from(sortCodes).where(and(eq(sortCodes.operationId, op.id), inArray(sortCodes.id, wanted)));
    if (known.length !== wanted.length) throw new RuleError('not_found');
  }
  let view = await routeDay(tx, op.id, input.date, route.id);
  if (!view) {
    const usual = usualOf(route, await ownerOn(tx, route.id, input.date));
    await writeAssignment(tx, actor, input.date, route.id, { ...usual, status: usual.driverId || usual.contractorId ? 'proposed' : 'no_driver' }, 'insert');
    view = (await routeDay(tx, op.id, input.date, route.id))!;
  }
  const before = (await tx.select({ id: executionSortCodes.sortCodeId }).from(executionSortCodes).where(eq(executionSortCodes.executionId, view.id))).map((x) => x.id);
  const gone = before.filter((x) => !wanted.includes(x));
  const added = wanted.filter((x) => !before.includes(x));
  // Taking off a suggested route changes nothing saved, but it still counts as set: the suggestion goes away.
  if (!gone.length && !added.length && (await sortCodesSetOn(tx, [view.id])).size) return before;
  if (gone.length) await tx.delete(executionSortCodes).where(and(eq(executionSortCodes.executionId, view.id), inArray(executionSortCodes.sortCodeId, gone)));
  if (added.length) await tx.insert(executionSortCodes).values(added.map((sortCodeId) => ({ executionId: view.id, sortCodeId, createdBy: actor.userId })));
  await audit(tx, { table: 'execution_sort_codes', recordId: view.id, action: 'update', before: { sortCodeIds: before }, after: { sortCodeIds: wanted }, userId: actor.userId, source: actor.source });
  return wanted;
}

/** Executions whose routes someone set (or that were saved on confirming), so they no longer show the suggestion. */
async function sortCodesSetOn(tx: Tx, executionIds: string[]) {
  if (!executionIds.length) return new Set<string>();
  const rows = await tx.selectDistinct({ id: auditLog.recordId }).from(auditLog)
    .where(and(eq(auditLog.tableName, 'execution_sort_codes'), inArray(auditLog.recordId, executionIds)));
  return new Set(rows.map((r) => r.id));
}

/** Confirming a day saves the driver code's usual routes on it, unless someone already set its routes. */
async function keepUsualSortCodes(tx: Tx, actor: Actor, executionId: string, routeId: string) {
  if ((await sortCodesSetOn(tx, [executionId])).size) return;
  const usual = (await usualSortCodes(tx, [routeId])).get(routeId) ?? [];
  if (!usual.length) return;
  await tx.insert(executionSortCodes).values(usual.map((u) => ({ executionId, sortCodeId: u.id, createdBy: actor.userId }))).onConflictDoNothing();
  await audit(tx, { table: 'execution_sort_codes', recordId: executionId, action: 'insert', after: { sortCodeIds: usual.map((u) => u.id) }, userId: actor.userId, source: actor.source });
}

// ---------- person first (Nov 2026): the operator confirms who works; the admin sets each one's driver code ----------
// A person who works today but has no driver code yet is a route execution without a route. The weekly check
// matches T-Force's report by code, so such a row is never paid by itself: pieces T-Force reports on the code they
// really drove show as "no driver" until someone gives them that code, which keeps payroll blocked meanwhile.

/** People on the day's list without a driver code yet, with the routes set for them. */
async function peopleWithoutCode(tx: Tx, operationId: string, date: string) {
  const rows = await tx.select().from(executionView).where(and(eq(executionView.operationId, operationId), eq(executionView.date, date),
    eq(executionView.kind, 'route'), isNull(executionView.routeId)));
  const ran = rows.length ? await tx.select({ executionId: executionSortCodes.executionId, id: sortCodes.id, code: sortCodes.code })
    .from(executionSortCodes).innerJoin(sortCodes, eq(sortCodes.id, executionSortCodes.sortCodeId))
    .where(inArray(executionSortCodes.executionId, rows.map((r) => r.id))).orderBy(asc(sortCodes.code)) : [];
  return rows.map((r) => ({ ...r, sortCodes: ran.filter((x) => x.executionId === r.id).map(({ id, code }) => ({ id, code })) }));
}

/** Who is on a driver code today: the saved person, or the usual one while the day is only proposed. */
async function onCode(tx: Tx, opId: string, date: string, route: typeof routes.$inferSelect) {
  const view = await routeDay(tx, opId, date, route.id);
  if (view) {
    const p = { driverId: view.payeeDriverId, contractorId: view.payeeContractorId };
    return { view, payee: p.driverId || p.contractorId ? p : null, confirmed: view.status === 'confirmed' || view.status === 'changed' };
  }
  const usual = usualOf(route, await ownerOn(tx, route.id, date));
  return { view: null, payee: usual.driverId || usual.contractorId ? usual : null, confirmed: false };
}

async function assertNotOnList(tx: Tx, opId: string, date: string, driverId: string) {
  const day = await tx.select().from(executionView).where(and(eq(executionView.operationId, opId), eq(executionView.date, date), eq(executionView.kind, 'route'),
    eq(executionView.payeeDriverId, driverId)));
  if (day.some((d) => d.status !== 'off' && d.status !== 'no_driver')) throw new RuleError('already_on_list');
  // Still only proposed on their usual driver code (nothing saved yet for that code today).
  const usual = await tx.select().from(routes).where(and(eq(routes.operationId, opId), eq(routes.active, true), eq(routes.usualDriverId, driverId)));
  for (const r of usual) if (!day.some((d) => d.routeId === r.id) && !(await ownerOn(tx, r.id, date))) throw new RuleError('already_on_list');
}

async function writePersonDay(tx: Tx, actor: Actor, opId: string, date: string, driverId: string) {
  const payeeId = await payeeIdOf(tx, { driverId, contractorId: null });
  const [row] = await tx.insert(routeExecutions).values({
    operationId: opId, date, kind: 'route', payeeId, driverId, status: 'confirmed', source: actor.source === 'whatsapp' ? 'whatsapp' : 'manual',
    confirmedBy: actor.userId, confirmedAt: new Date(),
  }).returning();
  await audit(tx, { table: 'route_executions', recordId: row!.id, action: 'insert', after: row, userId: actor.userId, source: actor.source });
  return row!;
}

async function personRow(tx: Tx, executionId: string) {
  const [row] = await tx.select().from(routeExecutions).where(and(eq(routeExecutions.id, executionId), isNull(routeExecutions.routeId), eq(routeExecutions.kind, 'route')));
  if (!row) throw new RuleError('not_found');
  return row;
}

async function dropPersonRow(tx: Tx, actor: Actor, row: typeof routeExecutions.$inferSelect) {
  const had = await tx.select().from(executionSortCodes).where(eq(executionSortCodes.executionId, row.id));
  if (had.length) {
    await tx.delete(executionSortCodes).where(eq(executionSortCodes.executionId, row.id));
    await audit(tx, { table: 'execution_sort_codes', recordId: row.id, action: 'update', before: { sortCodeIds: had.map((h) => h.sortCodeId) }, after: { sortCodeIds: [] }, userId: actor.userId, source: actor.source });
  }
  await tx.delete(routeExecutions).where(eq(routeExecutions.id, row.id));
  await audit(tx, { table: 'route_executions', recordId: row.id, action: 'delete', before: row, userId: actor.userId, source: actor.source });
}

/** Puts someone on today's list before they have a driver code (the admin sets it later). */
export async function addPersonToday(tx: Tx, actor: Actor, input: { date: string; driverId: string; operation?: string }) {
  assertCan(actor, 'drivers.confirm_today');
  const op = await operationFor(tx, input.operation, 'daily_list');
  await assertNotLocked(tx, op, input.date);
  await assertNotOnList(tx, op.id, input.date, input.driverId);
  await putOnTforce(tx, actor, input.driverId);
  return (await writePersonDay(tx, actor, op.id, input.date, input.driverId)).id;
}

/** Changes who a row without driver code is (picked the wrong person). */
export async function setPersonToday(tx: Tx, actor: Actor, input: { executionId: string; driverId: string }) {
  assertCan(actor, 'drivers.confirm_today');
  const row = await personRow(tx, input.executionId);
  const op = await getOperationById(tx, row.operationId);
  await assertNotLocked(tx, op, row.date);
  if (row.driverId === input.driverId) return row.id;
  await assertNotOnList(tx, op.id, row.date, input.driverId);
  await putOnTforce(tx, actor, input.driverId);
  const payeeId = await payeeIdOf(tx, { driverId: input.driverId, contractorId: null });
  const [after] = await tx.update(routeExecutions).set({ payeeId, driverId: input.driverId, status: 'changed', updatedAt: new Date() }).where(eq(routeExecutions.id, row.id)).returning();
  await audit(tx, { table: 'route_executions', recordId: row.id, action: 'update', before: row, after, userId: actor.userId, source: actor.source });
  return row.id;
}

/** Takes someone without driver code off today's list ("Didn't work today"). Returns them, for Undo. */
export async function removePersonToday(tx: Tx, actor: Actor, input: { executionId: string }) {
  assertCan(actor, 'drivers.confirm_today');
  const row = await personRow(tx, input.executionId);
  await assertNotLocked(tx, await getOperationById(tx, row.operationId), row.date);
  const sortCodeIds = (await tx.select().from(executionSortCodes).where(eq(executionSortCodes.executionId, row.id))).map((x) => x.sortCodeId);
  await dropPersonRow(tx, actor, row);
  return { date: row.date, driverId: row.driverId!, sortCodeIds };
}

/** The routes of a person without driver code. */
export async function setPersonSortCodes(tx: Tx, actor: Actor, input: { executionId: string; sortCodeIds: string[] }) {
  assertCan(actor, 'drivers.confirm_today');
  const row = await personRow(tx, input.executionId);
  await assertNotLocked(tx, await getOperationById(tx, row.operationId), row.date);
  return replaceSortCodes(tx, actor, row.operationId, row.id, input.sortCodeIds);
}

async function replaceSortCodes(tx: Tx, actor: Actor, opId: string, executionId: string, ids: string[]) {
  const wanted = [...new Set(ids)];
  if (wanted.length) {
    const known = await tx.select({ id: sortCodes.id }).from(sortCodes).where(and(eq(sortCodes.operationId, opId), inArray(sortCodes.id, wanted)));
    if (known.length !== wanted.length) throw new RuleError('not_found');
  }
  const before = (await tx.select({ id: executionSortCodes.sortCodeId }).from(executionSortCodes).where(eq(executionSortCodes.executionId, executionId))).map((x) => x.id);
  if (before.length === wanted.length && before.every((x) => wanted.includes(x)) && (await sortCodesSetOn(tx, [executionId])).size) return wanted;
  await tx.delete(executionSortCodes).where(eq(executionSortCodes.executionId, executionId));
  if (wanted.length) await tx.insert(executionSortCodes).values(wanted.map((sortCodeId) => ({ executionId, sortCodeId, createdBy: actor.userId })));
  await audit(tx, { table: 'execution_sort_codes', recordId: executionId, action: 'update', before: { sortCodeIds: before }, after: { sortCodeIds: wanted }, userId: actor.userId, source: actor.source });
  return wanted;
}

/** Routes set on an execution (null while they are only the usual ones, still a suggestion). */
async function setRoutesOf(tx: Tx, executionId: string | null) {
  if (!executionId || !(await sortCodesSetOn(tx, [executionId])).size) return null;
  return (await tx.select({ id: executionSortCodes.sortCodeId }).from(executionSortCodes).where(eq(executionSortCodes.executionId, executionId))).map((x) => x.id);
}

/**
 * Gives a person a driver code for the day (the admin's step), from their row with or without a code.
 * The person moves to that code with their routes. Whoever was on that code swaps places with them, or,
 * when the person had no code, becomes a person without code (if they were confirmed). A typed code that
 * doesn't exist yet is created with the person as its usual driver.
 */
export async function moveToCode(tx: Tx, actor: Actor, input: {
  date: string; from: { routeId: string } | { executionId: string }; to: { routeId: string } | { newCode: string }; operation?: string;
}) {
  assertCan(actor, 'drivers.confirm_today');
  const op = await operationFor(tx, input.operation, 'daily_list');
  await assertNotLocked(tx, op, input.date);

  // Who moves, and from where.
  let source: { route: typeof routes.$inferSelect; executionId: string | null } | { person: typeof routeExecutions.$inferSelect };
  let person: { driverId: string | null; contractorId: string | null };
  if ('routeId' in input.from) {
    const [route] = await tx.select().from(routes).where(and(eq(routes.id, input.from.routeId), eq(routes.operationId, op.id)));
    if (!route) throw new RuleError('not_found');
    const here = await onCode(tx, op.id, input.date, route);
    if (!here.payee) throw new RuleError('no_person');
    person = here.payee;
    source = { route, executionId: here.view?.id ?? null };
  } else {
    const row = await personRow(tx, input.from.executionId);
    person = { driverId: row.driverId, contractorId: null };
    source = { person: row };
  }

  // The driver code they move to.
  let target: typeof routes.$inferSelect;
  if ('routeId' in input.to) {
    const [r] = await tx.select().from(routes).where(and(eq(routes.id, input.to.routeId), eq(routes.operationId, op.id)));
    if (!r) throw new RuleError('not_found');
    target = r;
  } else {
    const code = input.to.newCode.trim().toUpperCase().replace(/\s+/g, '');
    if (!/^[A-Z0-9-]{2,12}$/.test(code)) throw new RuleError('route_code_invalid');
    const [clash] = await tx.select().from(routes).where(and(eq(routes.operationId, op.id), eq(routes.code, code)));
    target = clash ?? await createRoute(tx, actor, { operationId: op.id, code, contractorId: null, usualDriverId: person.driverId });
  }
  if (!target.active) target = await reactivate(tx, actor, target, null);
  if ('route' in source && source.route.id === target.id) return { code: target.code };

  const there = await onCode(tx, op.id, input.date, target);
  const movingRoutes = 'route' in source ? await setRoutesOf(tx, source.executionId) : (await tx.select().from(executionSortCodes).where(eq(executionSortCodes.executionId, source.person.id))).map((x) => x.sortCodeId);
  const thereRoutes = await setRoutesOf(tx, there.view?.id ?? null);

  // The person without code leaves that row first (it holds the payee for the day).
  if ('person' in source) await dropPersonRow(tx, actor, source.person);
  // A confirmed person already on the target code stays on the list: swapped, or without code.
  const other = there.payee && !(there.payee.driverId === person.driverId && there.payee.contractorId === person.contractorId) ? there.payee : null;
  if ('route' in source) {
    // Clear the old code first: a payee can't hold two codes the same day.
    await writeAssignment(tx, actor, input.date, source.route.id, { driverId: null, contractorId: null, status: 'no_driver' });
  }
  await assignRoute(tx, actor, { date: input.date, routeId: target.id, payee: person.driverId ? { driverId: person.driverId } : { contractorId: person.contractorId! } });
  const targetView = (await routeDay(tx, op.id, input.date, target.id))!;
  if (movingRoutes) await replaceSortCodes(tx, actor, op.id, targetView.id, movingRoutes);

  if ('route' in source) {
    if (other) {
      await assignRoute(tx, actor, { date: input.date, routeId: source.route.id, payee: other.driverId ? { driverId: other.driverId } : { contractorId: other.contractorId! } });
      const back = (await routeDay(tx, op.id, input.date, source.route.id))!;
      if (thereRoutes) await replaceSortCodes(tx, actor, op.id, back.id, thereRoutes);
    }
  } else if (other && there.confirmed && other.driverId) {
    const row = await writePersonDay(tx, actor, op.id, input.date, other.driverId);
    if (thereRoutes) await replaceSortCodes(tx, actor, op.id, row.id, thereRoutes);
  }
  return { code: target.code };
}

/**
 * "Confirm and send list" (the operator's step): confirms the usual drivers still proposed, then emails the
 * list to everyone marked "Gets the confirmed list of the day" in Team access. Each send is recorded.
 */
export async function sendDayList(tx: Tx, actor: Actor, date: string, operation?: string) {
  assertCan(actor, 'drivers.confirm_today');
  const confirmed = await confirmUsual(tx, actor, date, operation);
  const day = await loadDay(tx, actor, date, operation);
  const op = await operationFor(tx, operation, 'daily_list');
  const people: DayListPerson[] = [
    ...day.noCode.map((p) => ({ name: p.name, code: null, routes: p.sortCodes.map((x) => x.code), contractor: false })),
    ...day.rows.filter((r) => r.today.name && r.status !== 'off' && r.status !== 'no_driver')
      .map((r) => ({ name: r.today.name!, code: r.code, routes: r.sortCodes.map((x) => x.code), contractor: !!r.today.contractorId })),
  ];
  const codesNoDriver = day.rows.filter((r) => r.status === 'no_driver').map((r) => r.code);
  const to = await tx.select({ email: users.email, locale: users.locale }).from(users).where(and(eq(users.active, true), eq(users.receivesDayList, true)));
  const [me] = actor.userId ? await tx.select({ name: users.name }).from(users).where(eq(users.id, actor.userId)) : [];
  let sent = 0;
  for (const p of to) if (await sendMail(dayListEmail(isLocale(p.locale) ? p.locale : 'en', p.email, date, me?.name ?? actor.name, people, codesNoDriver, op.name))) sent++;
  const [row] = await tx.insert(dayListSends).values({ operationId: op.id, date, sentBy: actor.userId, recipients: sent }).returning();
  await audit(tx, { table: 'day_list_sends', recordId: row!.id, action: 'insert', after: { ...row, people: people.length }, userId: actor.userId, source: actor.source });
  return { confirmed, recipients: to.length, sent };
}

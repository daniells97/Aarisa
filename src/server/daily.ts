import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import type { Tx } from '~/db/client';
import { auditLog, contractors, drivers, executionView, routes, users } from '~/db/schema';
import { todayLA } from '~/domain/dates';
import { can } from '~/domain/permissions';
import { assertCan, type Actor } from './actor';
import { audit } from './audit';
import { RuleError } from './errors';
import { assertNotLocked, getOperation } from './ops';
import { payeeNamesById, routeDay, writeRouteDay } from './executions';
import { contractorProfiles, createDriver, createRoute, driverProfiles, routeOwners } from './people';

// Today's drivers (spec 6.3): who drove each T-Force route each day. No money here.

export type PayeeInput = { driverId: string } | { contractorId: string } | null;
export type DayStatus = 'proposed' | 'confirmed' | 'changed' | 'waiting' | 'no_driver';

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

export async function loadDay(tx: Tx, actor: Actor, date: string) {
  assertCan(actor, 'payroll.view');
  const op = await getOperation(tx, 'tforce');
  const routeRows = await tx.select().from(routes).where(and(eq(routes.operationId, op.id), eq(routes.active, true))).orderBy(asc(routes.code));
  const assignments = (routeRows.length
    ? await tx.select().from(executionView).where(and(eq(executionView.operationId, op.id), eq(executionView.date, date), eq(executionView.kind, 'route'), inArray(executionView.routeId, routeRows.map((r) => r.id))))
    : []).map((a) => ({ ...a, routeId: a.routeId!, driverId: a.payeeDriverId, contractorId: a.payeeContractorId }));
  const owners = await routeOwners(tx, date, routeRows.map((r) => r.id));
  const driverRows = await driverProfiles(tx, date);
  const contractorRows = (await contractorProfiles(tx)).filter((c) => c.active).map((c) => ({ id: c.id, name: c.name }));
  const dName = new Map(driverRows.map((d) => [d.id, d.fullName]));
  const cName = new Map(contractorRows.map((c) => [c.id, c.name]));
  const label = (p: { driverId: string | null; contractorId: string | null }) =>
    p.driverId ? dName.get(p.driverId) ?? '' : p.contractorId ? cName.get(p.contractorId) ?? '' : null;

  const rows = routeRows.map((r) => {
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
      status,
      source: a?.source ?? null,
      assignmentId: a?.id ?? null,
      updatedAt: a?.updatedAt.toISOString() ?? null,
    };
  });

  // Today's change log: audit entries for this day's executions, newest first. Executions kept the ids of
  // the daily assignments they replaced, so older entries (logged as daily_assignments) still show.
  const ids = assignments.map((a) => a.id);
  const log = ids.length ? await tx.select({ log: auditLog, user: users.name }).from(auditLog).leftJoin(users, eq(users.id, auditLog.userId))
    .where(and(inArray(auditLog.tableName, ['route_executions', 'daily_assignments']), inArray(auditLog.recordId, ids))).orderBy(desc(auditLog.at)).limit(50) : [];
  type Logged = { payeeId?: string | null; driverId?: string | null; contractorId?: string | null; rawName?: string | null };
  const logged = log.flatMap(({ log: l }) => [l.before, l.after] as (Logged | null)[]);
  const payeeName = await payeeNamesById(tx, [...new Set(logged.map((x) => x?.payeeId).filter((x): x is string => !!x))]);
  const nameOf = (x: Logged) => x.payeeId !== undefined ? (x.payeeId ? payeeName.get(x.payeeId) ?? '' : null)
    : label({ driverId: x.driverId ?? null, contractorId: x.contractorId ?? null });
  const routeOf = new Map(assignments.map((a) => [a.id, routeRows.find((r) => r.id === a.routeId)?.code ?? '']));
  const changes = log.map(({ log: l, user }) => {
    const af = (l.after ?? {}) as Logged;
    return {
      id: l.id, at: l.at.toISOString(), route: routeOf.get(l.recordId) ?? '', action: l.action, source: l.source, user: user ?? null,
      from: l.before ? nameOf(l.before as Logged) : null,
      to: nameOf(af) ?? af.rawName ?? null,
    };
  });

  const count = (s: DayStatus | 'contractor') => rows.filter((r) => (s === 'contractor' ? r.contractorRoute && r.status !== 'no_driver' : !r.contractorRoute && r.status === s)).length;
  return {
    date,
    canEdit: can(actor.role, 'drivers.confirm_today'),
    rows,
    summary: {
      routes: rows.length,
      confirmed: count('confirmed') + count('changed'),
      proposed: count('proposed'),
      contractor: count('contractor'),
      waiting: count('waiting'),
      noDriver: rows.filter((r) => r.status === 'no_driver').length,
    },
    options: {
      drivers: driverRows.filter((d) => d.active).map((d) => ({ id: d.id, name: d.fullName, contractor: d.contractorId ? cName.get(d.contractorId) ?? null : null })),
      contractors: contractorRows,
    },
    changes,
  };
}

async function writeAssignment(tx: Tx, actor: Actor, date: string, routeId: string, values: {
  driverId: string | null; contractorId: string | null; rawName?: string | null; status: DayStatus;
}, action: 'insert' | 'update' | 'undo' = 'update') {
  const op = await getOperation(tx, 'tforce');
  await assertNotLocked(tx, op, date);
  const [route] = await tx.select().from(routes).where(and(eq(routes.id, routeId), eq(routes.operationId, op.id)));
  if (!route) throw new RuleError('not_found');
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
  const { before, after } = await writeRouteDay(tx, {
    operationId: op.id, date, routeId, payee: { driverId: values.driverId, contractorId: values.contractorId }, rawName: values.rawName ?? null,
    status: values.status, source, userId: actor.userId,
  });
  await audit(tx, { table: 'route_executions', recordId: after.id, action: before ? action : 'insert', before, after, userId: actor.userId, source: actor.source });
  // Callers undo to the previous driver or contractor, so hand back that shape.
  const previous = view ? { driverId: view.payeeDriverId, contractorId: view.payeeContractorId, rawName: view.rawName, status: view.status } : null;
  return { before: previous, after };
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
export async function confirmUsual(tx: Tx, actor: Actor, date: string) {
  assertCan(actor, 'drivers.confirm_today');
  const day = await loadDay(tx, actor, date);
  let n = 0;
  for (const r of day.rows) {
    if (r.status !== 'proposed') continue;
    await writeAssignment(tx, actor, date, r.routeId, { driverId: r.usual.driverId, contractorId: r.usual.contractorId, status: 'confirmed' });
    n++;
  }
  return n;
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
export async function addRoute(tx: Tx, actor: Actor, input: { date: string; code: string; payee: NewRoutePayee }) {
  assertCan(actor, 'drivers.confirm_today');
  const code = input.code.trim().toUpperCase().replace(/\s+/g, '');
  if (!/^[A-Z0-9-]{2,12}$/.test(code)) throw new RuleError('route_code_invalid');
  const op = await getOperation(tx, 'tforce');
  await assertNotLocked(tx, op, input.date);
  const [clash] = await tx.select({ id: routes.id, active: routes.active }).from(routes).where(and(eq(routes.operationId, op.id), eq(routes.code, code)));
  if (clash) throw new RuleError(clash.active ? 'route_exists' : 'route_inactive');

  let payee: { driverId: string } | { contractorId: string };
  if ('newDriverName' in input.payee) payee = { driverId: (await createQuickDriver(tx, actor, input.payee.newDriverName, null)).id };
  else payee = input.payee;
  const cols = payeeCols(payee);
  if (cols.driverId && !(await tx.select({ id: drivers.id }).from(drivers).where(eq(drivers.id, cols.driverId))).length) throw new RuleError('not_found');
  if (cols.contractorId && !(await tx.select({ id: contractors.id }).from(contractors).where(eq(contractors.id, cols.contractorId))).length) throw new RuleError('not_found');

  const route = await createRoute(tx, actor, { operationId: op.id, code, contractorId: cols.contractorId, usualDriverId: cols.driverId });
  await writeAssignment(tx, actor, input.date, route.id, { ...cols, status: 'confirmed' });
  return route;
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

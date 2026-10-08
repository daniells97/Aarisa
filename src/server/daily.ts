import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import type { Tx } from '~/db/client';
import { auditLog, contractors, dailyAssignments, drivers, routes, users } from '~/db/schema';
import { can } from '~/domain/permissions';
import { assertCan, type Actor } from './actor';
import { audit } from './audit';
import { RuleError } from './errors';
import { assertNotLocked, getOperation } from './ops';

// Today's drivers (spec 6.3): who drove each T-Force route each day. No money here.

export type PayeeInput = { driverId: string } | { contractorId: string } | null;
export type DayStatus = 'proposed' | 'confirmed' | 'changed' | 'waiting' | 'no_driver';

const samePayee = (a: { driverId: string | null; contractorId: string | null }, b: { driverId: string | null; contractorId: string | null }) =>
  a.driverId === b.driverId && a.contractorId === b.contractorId;

function payeeCols(p: PayeeInput) {
  return { driverId: p && 'driverId' in p ? p.driverId : null, contractorId: p && 'contractorId' in p ? p.contractorId : null };
}

/** Usual payee of a route: its contractor if it is a contractor route, else its usual driver. */
function usualOf(r: typeof routes.$inferSelect) {
  return r.contractorId ? { driverId: null, contractorId: r.contractorId } : { driverId: r.usualDriverId, contractorId: null };
}

export async function loadDay(tx: Tx, actor: Actor, date: string) {
  assertCan(actor, 'payroll.view');
  const op = await getOperation(tx, 'tforce');
  const routeRows = await tx.select().from(routes).where(and(eq(routes.operationId, op.id), eq(routes.active, true))).orderBy(asc(routes.code));
  const assignments = routeRows.length
    ? await tx.select().from(dailyAssignments).where(and(eq(dailyAssignments.date, date), inArray(dailyAssignments.routeId, routeRows.map((r) => r.id))))
    : [];
  const driverRows = await tx.select({ id: drivers.id, name: drivers.fullName, contractorId: drivers.contractorId, active: drivers.active, setupComplete: drivers.setupComplete }).from(drivers).orderBy(asc(drivers.fullName));
  const contractorRows = await tx.select({ id: contractors.id, name: contractors.name }).from(contractors).where(eq(contractors.active, true)).orderBy(asc(contractors.name));
  const dName = new Map(driverRows.map((d) => [d.id, d.name]));
  const cName = new Map(contractorRows.map((c) => [c.id, c.name]));
  const label = (p: { driverId: string | null; contractorId: string | null }) =>
    p.driverId ? dName.get(p.driverId) ?? '' : p.contractorId ? cName.get(p.contractorId) ?? '' : null;

  const rows = routeRows.map((r) => {
    const a = assignments.find((x) => x.routeId === r.id);
    const usual = usualOf(r);
    const today = a ? { driverId: a.driverId, contractorId: a.contractorId } : usual;
    const status: DayStatus = a ? a.status : usual.driverId || usual.contractorId ? 'proposed' : 'no_driver';
    return {
      routeId: r.id, code: r.code, contractorRoute: !!r.contractorId,
      usual: { ...usual, name: label(usual) },
      today: { ...today, name: label(today) },
      rawName: a?.rawName ?? null,
      status,
      source: a?.source ?? null,
      assignmentId: a?.id ?? null,
      updatedAt: a?.updatedAt.toISOString() ?? null,
    };
  });

  // Today's change log: audit entries for this day's assignments, newest first.
  const ids = assignments.map((a) => a.id);
  const log = ids.length ? await tx.select({ log: auditLog, user: users.name }).from(auditLog).leftJoin(users, eq(users.id, auditLog.userId))
    .where(and(eq(auditLog.tableName, 'daily_assignments'), inArray(auditLog.recordId, ids))).orderBy(desc(auditLog.at)).limit(50) : [];
  const routeOf = new Map(assignments.map((a) => [a.id, routeRows.find((r) => r.id === a.routeId)?.code ?? '']));
  const changes = log.map(({ log: l, user }) => {
    const b = (l.before ?? {}) as { driverId?: string | null; contractorId?: string | null };
    const af = (l.after ?? {}) as { driverId?: string | null; contractorId?: string | null; rawName?: string | null };
    return {
      id: l.id, at: l.at.toISOString(), route: routeOf.get(l.recordId) ?? '', action: l.action, source: l.source, user: user ?? null,
      from: l.before ? label({ driverId: b.driverId ?? null, contractorId: b.contractorId ?? null }) : null,
      to: label({ driverId: af.driverId ?? null, contractorId: af.contractorId ?? null }) ?? af.rawName ?? null,
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
      drivers: driverRows.filter((d) => d.active).map((d) => ({ id: d.id, name: d.name, contractor: d.contractorId ? cName.get(d.contractorId) ?? null : null })),
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
  const stamp = { source, confirmedBy: actor.userId, confirmedAt: new Date(), updatedAt: new Date() };
  const [before] = await tx.select().from(dailyAssignments).where(and(eq(dailyAssignments.date, date), eq(dailyAssignments.routeId, routeId)));
  let after;
  if (before) {
    [after] = await tx.update(dailyAssignments).set({ ...values, rawName: values.rawName ?? null, ...stamp }).where(eq(dailyAssignments.id, before.id)).returning();
  } else {
    [after] = await tx.insert(dailyAssignments).values({ date, routeId, ...values, rawName: values.rawName ?? null, ...stamp }).returning();
  }
  await audit(tx, { table: 'daily_assignments', recordId: after!.id, action: before ? action : 'insert', before: before ?? null, after, userId: actor.userId, source: actor.source });
  return { before: before ?? null, after: after! };
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
  const status: DayStatus = !cols.driverId && !cols.contractorId ? 'no_driver' : samePayee(cols, usualOf(route)) ? 'confirmed' : 'changed';
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
  const values = input.previous ?? { ...usualOf(route), rawName: null, status: 'proposed' as const };
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
  const name = input.fullName.trim();
  if (!name) throw new RuleError('name_required');
  const [d] = await tx.insert(drivers).values({ fullName: name, contractorId: input.contractorId, setupComplete: false }).returning();
  await audit(tx, { table: 'drivers', recordId: d!.id, action: 'insert', after: d, userId: actor.userId, source: actor.source });
  await setAssignment(tx, actor, { date: input.date, routeId: input.routeId, payee: { driverId: d!.id } });
  return d!;
}

/** Records an unrecognised name on a route (from the daily list or WhatsApp), leaving it without a driver. */
export async function setUnknownName(tx: Tx, actor: Actor, input: { date: string; routeId: string; rawName: string }) {
  assertCan(actor, 'drivers.confirm_today');
  await writeAssignment(tx, actor, input.date, input.routeId, { driverId: null, contractorId: null, rawName: input.rawName, status: 'no_driver' });
}

import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { Tx } from '~/db/client';
import { contractors, drivers, executionView, payees, routeExecutions } from '~/db/schema';
import { RuleError } from './errors';

// Executions (docs/db-model.md §2.6): one payee, one day, one route or none. Screens still speak in
// driverId / contractorId; these helpers turn that into the payee stored on the execution and back.

export type PayeeRef = { driverId: string | null; contractorId: string | null };
type Source = typeof routeExecutions.$inferInsert.source;
type Status = typeof routeExecutions.$inferInsert.status;

/** The payee row behind a driver or a contractor (null when nobody). Throws when the id is unknown. */
export async function payeeIdOf(tx: Tx, p: PayeeRef): Promise<string | null> {
  if (p.driverId) {
    const [d] = await tx.select({ payeeId: drivers.payeeId }).from(drivers).where(eq(drivers.id, p.driverId));
    if (!d) throw new RuleError('not_found');
    return d.payeeId;
  }
  if (p.contractorId) {
    const [c] = await tx.select({ payeeId: contractors.payeeId, own: contractors.isOwnCompany }).from(contractors).where(eq(contractors.id, p.contractorId));
    if (!c) throw new RuleError('not_found');
    if (c.own) throw new RuleError('own_company_not_payee'); // Aarisa owns routes but is never paid
    return c.payeeId;
  }
  return null;
}

/** payeeId → driver or contractor, for every payee (small table). */
export async function payeeRefs(tx: Tx): Promise<Map<string, PayeeRef>> {
  const d = await tx.select({ id: drivers.id, payeeId: drivers.payeeId }).from(drivers);
  const c = await tx.select({ id: contractors.id, payeeId: contractors.payeeId }).from(contractors);
  return new Map<string, PayeeRef>([
    ...d.map((x) => [x.payeeId, { driverId: x.id, contractorId: null }] as const),
    ...c.map((x) => [x.payeeId, { driverId: null, contractorId: x.id }] as const),
  ]);
}

/** payeeId for each driver ('d:<id>') and contractor ('c:<id>') key, as used by the payroll domain. */
export async function payeeIdsByKey(tx: Tx): Promise<Map<string, string>> {
  const refs = await payeeRefs(tx);
  return new Map([...refs].map(([payeeId, r]) => [r.driverId ? `d:${r.driverId}` : `c:${r.contractorId}`, payeeId]));
}

export async function payeeNamesById(tx: Tx, ids: string[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map();
  const rows = await tx.select({ id: payees.id, name: payees.displayName }).from(payees).where(inArray(payees.id, ids));
  return new Map(rows.map((r) => [r.id, r.name]));
}

/** The route execution of a route on a day, as the daily list sees it. */
export async function routeDay(tx: Tx, operationId: string, date: string, routeId: string) {
  const [row] = await tx.select().from(executionView)
    .where(and(eq(executionView.operationId, operationId), eq(executionView.date, date), eq(executionView.routeId, routeId), eq(executionView.kind, 'route')));
  return row ?? null;
}

/**
 * Writes who drove a route on a day (daily list, WhatsApp, weekly-check fixes). Creates the execution
 * when the day has none yet. A contractor is the payee on its routes; `driverId` keeps who drove.
 */
export async function writeRouteDay(tx: Tx, input: {
  operationId: string; date: string; routeId: string; payee: PayeeRef; rawName: string | null; status: Status; source: Source; userId: string | null;
}) {
  const payeeId = await payeeIdOf(tx, input.payee);
  const confirmed = input.status === 'confirmed' || input.status === 'changed';
  const values = {
    payeeId, driverId: input.payee.driverId, rawName: input.rawName, status: input.status, source: input.source,
    confirmedBy: confirmed ? input.userId : null, confirmedAt: confirmed ? new Date() : null, updatedAt: new Date(),
  };
  const [before] = await tx.select().from(routeExecutions).where(and(
    eq(routeExecutions.operationId, input.operationId), eq(routeExecutions.date, input.date), eq(routeExecutions.routeId, input.routeId), eq(routeExecutions.kind, 'route')));
  const [after] = before
    ? await tx.update(routeExecutions).set(values).where(eq(routeExecutions.id, before.id)).returning()
    : await tx.insert(routeExecutions).values({ operationId: input.operationId, date: input.date, routeId: input.routeId, kind: 'route', ...values }).returning();
  return { before: before ?? null, after: after! };
}

/** The execution a T-Force report row belongs to; a day the list never mentioned starts without a driver. */
export async function reportRouteDay(tx: Tx, input: { operationId: string; date: string; routeId: string; importId: string }) {
  const [found] = await tx.select().from(routeExecutions).where(and(
    eq(routeExecutions.operationId, input.operationId), eq(routeExecutions.date, input.date), eq(routeExecutions.routeId, input.routeId), eq(routeExecutions.kind, 'route')));
  if (found) return { row: found, created: false };
  const [row] = await tx.insert(routeExecutions).values({
    operationId: input.operationId, date: input.date, routeId: input.routeId, kind: 'route', status: 'no_driver', source: 'client_report', importId: input.importId,
  }).returning();
  return { row: row!, created: true };
}

/** A Hovership driver-day: no route, the report names the driver. */
export async function driverDay(tx: Tx, input: { operationId: string; date: string; driverId: string; importId: string }) {
  const payeeId = (await payeeIdOf(tx, { driverId: input.driverId, contractorId: null }))!;
  const [found] = await tx.select().from(routeExecutions).where(and(
    eq(routeExecutions.operationId, input.operationId), eq(routeExecutions.date, input.date), eq(routeExecutions.payeeId, payeeId),
    eq(routeExecutions.kind, 'route'), isNull(routeExecutions.routeId)));
  if (found) return { row: found, created: false };
  const [row] = await tx.insert(routeExecutions).values({
    operationId: input.operationId, date: input.date, kind: 'route', payeeId, driverId: input.driverId, status: 'confirmed', source: 'client_report',
    importId: input.importId, confirmedAt: new Date(),
  }).returning();
  return { row: row!, created: true };
}

/** The `extra` execution of a payee on a day: extra jobs are paid without counting as a route day. */
export async function extraDay(tx: Tx, input: { operationId: string; date: string; payee: PayeeRef; source: Source; userId: string | null }) {
  const payeeId = (await payeeIdOf(tx, input.payee))!;
  const [found] = await tx.select().from(routeExecutions).where(and(
    eq(routeExecutions.operationId, input.operationId), eq(routeExecutions.date, input.date), eq(routeExecutions.payeeId, payeeId), eq(routeExecutions.kind, 'extra')));
  if (found) return { row: found, created: false };
  const [row] = await tx.insert(routeExecutions).values({
    operationId: input.operationId, date: input.date, kind: 'extra', payeeId, driverId: input.payee.driverId, status: 'confirmed', source: input.source,
    confirmedBy: input.userId, confirmedAt: new Date(),
  }).returning();
  return { row: row!, created: true };
}

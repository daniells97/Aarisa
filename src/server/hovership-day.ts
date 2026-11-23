import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import type { Tx } from '~/db/client';
import { auditLog, executionSortCodes, executionView, routeExecutions, sortCodes, users } from '~/db/schema';
import { can } from '~/domain/permissions';
import { assertCan, type Actor } from './actor';
import { audit } from './audit';
import { RuleError } from './errors';
import { payeeIdOf } from './executions';
import { assertNotLocked, operationFor } from './ops';
import { driverProfiles } from './people';

// Today's drivers for Hovership: which routes (sort codes) each Hovership driver runs on a day. Hovership's
// report already names the driver, so there is no driver code and nothing to confirm; Aarisa assigns the
// routes by hand. A driver-day made here is the same one the weekly report fills, and pays nothing by itself.

export async function loadHovershipDay(tx: Tx, actor: Actor, date: string, operation?: string) {
  assertCan(actor, 'payroll.view');
  const op = await operationFor(tx, operation, 'report_code');
  const people = (await driverProfiles(tx, date)).filter((d) => d.active && d.worksHovership);
  const days = await tx.select().from(executionView)
    .where(and(eq(executionView.operationId, op.id), eq(executionView.date, date), eq(executionView.kind, 'route'), isNull(executionView.routeId)));
  const dayOf = new Map(days.filter((d) => d.payeeDriverId).map((d) => [d.payeeDriverId!, d]));
  const ran = days.length ? await tx.select({ executionId: executionSortCodes.executionId, id: sortCodes.id, code: sortCodes.code })
    .from(executionSortCodes).innerJoin(sortCodes, eq(sortCodes.id, executionSortCodes.sortCodeId))
    .where(inArray(executionSortCodes.executionId, days.map((d) => d.id))).orderBy(asc(sortCodes.code)) : [];
  const options = await tx.select({ id: sortCodes.id, code: sortCodes.code }).from(sortCodes)
    .where(and(eq(sortCodes.operationId, op.id), eq(sortCodes.active, true))).orderBy(asc(sortCodes.code));

  const rows = people.map((p) => {
    const day = dayOf.get(p.id);
    return { driverId: p.id, name: p.fullName, code: p.hovershipCode, sortCodes: day ? ran.filter((r) => r.executionId === day.id).map(({ id, code }) => ({ id, code })) : [] };
  });
  const taken = new Map<string, string[]>();
  for (const r of rows) for (const s of r.sortCodes) taken.set(s.code, [...(taken.get(s.code) ?? []), r.name]);

  // The day's route changes, newest first.
  const log = days.length ? await tx.select({ log: auditLog, user: users.name }).from(auditLog).leftJoin(users, eq(users.id, auditLog.userId))
    .where(and(eq(auditLog.tableName, 'execution_sort_codes'), inArray(auditLog.recordId, days.map((d) => d.id)))).orderBy(asc(auditLog.at)) : [];
  const name = new Map([...options, ...ran].map((x) => [x.id, x.code]));
  const driverOf = new Map(days.map((d) => [d.id, people.find((p) => p.id === d.payeeDriverId)?.fullName ?? '']));

  return {
    date,
    operation: { code: op.code, name: op.name },
    canEdit: can(actor.role, 'drivers.confirm_today'),
    rows,
    options: { sortCodes: options },
    summary: {
      drivers: rows.length,
      working: rows.filter((r) => r.sortCodes.length > 0).length,
      // Routes nobody has today, and routes given to more than one person.
      unassigned: options.filter((o) => !taken.has(o.code)).map((o) => o.code),
      shared: [...taken].filter(([, who]) => who.length > 1).map(([code, who]) => ({ code, who })),
    },
    changes: log.reverse().map(({ log: l, user }) => ({
      id: l.id, at: l.at.toISOString(), driver: driverOf.get(l.recordId) ?? '', user: user ?? null, source: l.source,
      sortCodes: (((l.after ?? {}) as { sortCodeIds?: string[] }).sortCodeIds ?? []).map((x) => name.get(x) ?? '?'),
    })),
  };
}

/** The routes a Hovership driver runs on a day, replacing what was there. */
export async function setHovershipRoutes(tx: Tx, actor: Actor, input: { date: string; driverId: string; sortCodeIds: string[]; operation?: string }) {
  assertCan(actor, 'drivers.confirm_today');
  const op = await operationFor(tx, input.operation, 'report_code');
  await assertNotLocked(tx, op, input.date);
  const [person] = await driverProfiles(tx, input.date, [input.driverId]);
  if (!person) throw new RuleError('not_found');
  const wanted = [...new Set(input.sortCodeIds)];
  if (wanted.length) {
    const known = await tx.select({ id: sortCodes.id }).from(sortCodes).where(and(eq(sortCodes.operationId, op.id), inArray(sortCodes.id, wanted)));
    if (known.length !== wanted.length) throw new RuleError('not_found');
  }
  const payeeId = (await payeeIdOf(tx, { driverId: person.id, contractorId: null }))!;
  let [day] = await tx.select().from(routeExecutions).where(and(eq(routeExecutions.operationId, op.id), eq(routeExecutions.date, input.date),
    eq(routeExecutions.payeeId, payeeId), eq(routeExecutions.kind, 'route'), isNull(routeExecutions.routeId)));
  if (!day) {
    [day] = await tx.insert(routeExecutions).values({
      operationId: op.id, date: input.date, kind: 'route', payeeId, driverId: person.id, status: 'confirmed', source: 'manual',
      confirmedBy: actor.userId, confirmedAt: new Date(),
    }).returning();
    await audit(tx, { table: 'route_executions', recordId: day!.id, action: 'insert', after: day, userId: actor.userId, source: actor.source });
  }
  const before = (await tx.select({ id: executionSortCodes.sortCodeId }).from(executionSortCodes).where(eq(executionSortCodes.executionId, day!.id))).map((x) => x.id);
  await tx.delete(executionSortCodes).where(eq(executionSortCodes.executionId, day!.id));
  if (wanted.length) await tx.insert(executionSortCodes).values(wanted.map((sortCodeId) => ({ executionId: day!.id, sortCodeId, createdBy: actor.userId })));
  await audit(tx, { table: 'execution_sort_codes', recordId: day!.id, action: 'update', before: { sortCodeIds: before }, after: { sortCodeIds: wanted }, userId: actor.userId, source: actor.source });
  return wanted;
}

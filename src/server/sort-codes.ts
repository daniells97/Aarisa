import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { Tx } from '~/db/client';
import { executionSortCodes, operations, routes, routeUsualSortCodes, sortCodes } from '~/db/schema';
import { can } from '~/domain/permissions';
import { todayLA } from '~/domain/dates';
import { assertCan, type Actor } from './actor';
import { audit } from './audit';
import { RuleError } from './errors';
import { usualRoutesOf } from './hovership-day';
import { driverProfiles } from './people';

// The routes (sort codes) of each contract, kept by the owner in Drivers and rates, and each T-Force
// driver code's usual routes, which Today's drivers suggests every day. Aarisa assigns them by hand.

const clean = (code: string) => code.trim().replace(/\s+/g, ' ');

export async function loadSortCodes(tx: Tx, actor: Actor) {
  assertCan(actor, 'payroll.view');
  const ops = await tx.select().from(operations).where(eq(operations.active, true)).orderBy(asc(operations.createdAt), asc(operations.code));
  const codes = await tx.select().from(sortCodes).orderBy(asc(sortCodes.code));
  const used = new Set((await tx.selectDistinct({ id: executionSortCodes.sortCodeId }).from(executionSortCodes)).map((x) => x.id));
  const driverCodes = await tx.select({ id: routes.id, code: routes.code, operationId: routes.operationId, usualDriverId: routes.usualDriverId })
    .from(routes).innerJoin(operations, eq(operations.id, routes.operationId))
    .where(and(eq(routes.active, true), eq(operations.driverSource, 'daily_list'))).orderBy(asc(routes.code));
  const usual = driverCodes.length ? await tx.select({ routeId: routeUsualSortCodes.routeId, id: sortCodes.id, code: sortCodes.code })
    .from(routeUsualSortCodes).innerJoin(sortCodes, eq(sortCodes.id, routeUsualSortCodes.sortCodeId))
    .where(inArray(routeUsualSortCodes.routeId, driverCodes.map((d) => d.id))).orderBy(asc(sortCodes.code)) : [];
  // Hovership has no driver codes: its people on Hovership keep usual routes of their own.
  const hovershipPeople = (await driverProfiles(tx, todayLA())).filter((p) => p.active && p.worksHovership);
  const personUsual = await usualRoutesOf(tx, hovershipPeople.map((p) => p.id));
  return {
    canEdit: can(actor.role, 'setup.edit'),
    operations: ops.map((o) => ({
      code: o.code, name: o.name,
      sortCodes: codes.filter((c) => c.operationId === o.id).map((c) => ({ id: c.id, code: c.code, active: c.active, used: used.has(c.id) })),
      drivers: driverCodes.filter((d) => d.operationId === o.id).map((d) => ({
        routeId: d.id, code: d.code, usual: usual.filter((u) => u.routeId === d.id).map(({ id, code }) => ({ id, code })),
      })),
      people: o.driverSource === 'report_code'
        ? hovershipPeople.map((p) => ({ driverId: p.id, name: p.fullName, code: p.hovershipCode, usual: personUsual.get(p.id) ?? [] }))
        : [],
    })),
  };
}

async function assertFree(tx: Tx, operationId: string, code: string, except?: string) {
  const [clash] = await tx.select({ id: sortCodes.id }).from(sortCodes)
    .where(and(eq(sortCodes.operationId, operationId), eq(sql`lower(${sortCodes.code})`, code.toLowerCase())));
  if (clash && clash.id !== except) throw new RuleError('sort_code_exists');
}

export async function addSortCode(tx: Tx, actor: Actor, input: { operation: string; code: string }) {
  assertCan(actor, 'setup.edit');
  const code = clean(input.code);
  if (!code || code.length > 30) throw new RuleError('sort_code_invalid');
  const [op] = await tx.select().from(operations).where(eq(operations.code, input.operation));
  if (!op) throw new RuleError('not_found');
  await assertFree(tx, op.id, code);
  const [row] = await tx.insert(sortCodes).values({ operationId: op.id, code }).returning();
  await audit(tx, { table: 'sort_codes', recordId: row!.id, action: 'insert', after: row, userId: actor.userId, source: actor.source });
  return row!;
}

/** Renames or turns a route off. Days that already used it keep it; an inactive one isn't offered any more. */
export async function updateSortCode(tx: Tx, actor: Actor, id: string, input: { code: string; active: boolean }) {
  assertCan(actor, 'setup.edit');
  const [before] = await tx.select().from(sortCodes).where(eq(sortCodes.id, id));
  if (!before) throw new RuleError('not_found');
  const code = clean(input.code);
  if (!code || code.length > 30) throw new RuleError('sort_code_invalid');
  await assertFree(tx, before.operationId, code, id);
  const [after] = await tx.update(sortCodes).set({ code, active: input.active }).where(eq(sortCodes.id, id)).returning();
  await audit(tx, { table: 'sort_codes', recordId: id, action: 'update', before, after, userId: actor.userId, source: actor.source });
  return after!;
}

/** A driver code's usual routes, replacing what was there. */
export async function setUsualSortCodes(tx: Tx, actor: Actor, input: { routeId: string; sortCodeIds: string[] }) {
  assertCan(actor, 'setup.edit');
  const [route] = await tx.select().from(routes).where(eq(routes.id, input.routeId));
  if (!route) throw new RuleError('not_found');
  const wanted = [...new Set(input.sortCodeIds)];
  if (wanted.length) {
    const known = await tx.select({ id: sortCodes.id }).from(sortCodes).where(and(eq(sortCodes.operationId, route.operationId), inArray(sortCodes.id, wanted)));
    if (known.length !== wanted.length) throw new RuleError('not_found');
  }
  const before = (await tx.select({ id: routeUsualSortCodes.sortCodeId }).from(routeUsualSortCodes).where(eq(routeUsualSortCodes.routeId, route.id))).map((x) => x.id);
  await tx.delete(routeUsualSortCodes).where(eq(routeUsualSortCodes.routeId, route.id));
  if (wanted.length) await tx.insert(routeUsualSortCodes).values(wanted.map((sortCodeId) => ({ routeId: route.id, sortCodeId, createdBy: actor.userId })));
  await audit(tx, { table: 'route_usual_sort_codes', recordId: route.id, action: 'update', before: { sortCodeIds: before }, after: { sortCodeIds: wanted }, userId: actor.userId, source: actor.source });
  return wanted;
}

/** Usual routes per driver code, for Today's drivers. */
export async function usualSortCodes(tx: Tx, routeIds: string[]) {
  if (!routeIds.length) return new Map<string, { id: string; code: string }[]>();
  const rows = await tx.select({ routeId: routeUsualSortCodes.routeId, id: sortCodes.id, code: sortCodes.code })
    .from(routeUsualSortCodes).innerJoin(sortCodes, eq(sortCodes.id, routeUsualSortCodes.sortCodeId))
    .where(and(inArray(routeUsualSortCodes.routeId, routeIds), eq(sortCodes.active, true))).orderBy(asc(sortCodes.code));
  const map = new Map<string, { id: string; code: string }[]>();
  for (const r of rows) map.set(r.routeId, [...(map.get(r.routeId) ?? []), { id: r.id, code: r.code }]);
  return map;
}

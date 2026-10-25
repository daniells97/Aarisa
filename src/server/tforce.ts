import { and, asc, desc, eq, gte, inArray, lt, lte } from 'drizzle-orm';
import type { Tx } from '~/db/client';
import { executionView, exceptions, operations, reportImports, routes, settlementLines, workView } from '~/db/schema';
import { addDays, weekStart } from '~/domain/dates';
import { can } from '~/domain/permissions';
import { crossCheck, pieceGrid, type CheckException, type ListEntry, type Payee, type ReportRow } from '~/domain/tforce';
import { assertCan, type Actor } from './actor';
import { audit, type AuditEntry } from './audit';
import { assignRoute, type PayeeInput } from './daily';
import { RuleError } from './errors';
import { assertNotLocked, getOperation, lockedPeriodStarts, operationFor } from './ops';
import { payeeNameMaps, routeOwners } from './people';
import { refreshWeeklyLines } from './settlements';
import { importReport, type ImportProblems } from './imports';
import { claimBasis, openClaim, payQuantityFor } from './claims';

// T-Force weekly check (spec §5.3, 6.4). Report rows become e-commerce work records; the check joins
// them to the daily list and keeps one exception per (type, date, route) until someone resolves it.

/** Imports a T-Force-style report (route and pieces, driver from the daily list) through the generic reader. */
export async function importTforce(tx: Tx, actor: Actor, input: { fileName: string; text: string; columnOverride?: Record<string, string>; channel?: 'upload' | 'email'; operation?: string }) {
  return importReport(tx, actor, { ...input, operation: input.operation ?? (await operationFor(tx, undefined, 'daily_list')).code });
}

const exKey = (type: string, date: string, routeId: string | null) => `${type}|${date}|${routeId ?? ''}`;

/**
 * Re-runs the check for a week and reconciles exceptions. The payee of a report row is the payee of its
 * execution, so a daily-list change already moves the row. Runs after an import and after any
 * daily-list change in an imported week.
 */
export async function runWeeklyCheck(tx: Tx, actor: Actor, operation: string, start: string) {
  const op = await getOperation(tx, operation);
  const end = addDays(start, 6);
  const routeRows = await tx.select().from(routes).where(eq(routes.operationId, op.id));
  const codeOf = new Map(routeRows.map((r) => [r.id, r.code]));
  const idOf = new Map(routeRows.map((r) => [r.code, r.id]));

  const records = await tx.select().from(workView).where(and(eq(workView.operationId, op.id), eq(workView.source, 'client_report'), gte(workView.date, start), lte(workView.date, end)));
  if (!records.length) return { open: 0 };
  const history = await tx.select().from(workView).where(and(eq(workView.operationId, op.id), eq(workView.source, 'client_report'), gte(workView.date, addDays(start, -28)), lt(workView.date, start)));
  const assignments = (await tx.select().from(executionView).where(and(eq(executionView.operationId, op.id), eq(executionView.kind, 'route'), gte(executionView.date, start), lte(executionView.date, end))))
    .filter((a) => a.routeId).map((a) => ({ ...a, routeId: a.routeId!, driverId: a.payeeDriverId, contractorId: a.payeeContractorId }));

  const toRow = (w: typeof records[number]): ReportRow => ({ date: w.date, route: codeOf.get(w.routeId!)!, pieces: w.pieces });
  const list: ListEntry[] = assignments.map((a) => ({
    date: a.date, route: codeOf.get(a.routeId)!, rawName: a.rawName,
    payee: a.driverId ? { driverId: a.driverId } : a.contractorId ? { contractorId: a.contractorId } : null,
  }));
  // The low-pieces threshold is a rule of the contract (open question 12), in basis points.
  const result = crossCheck(records.map(toRow), list, history.map(toRow), op.lowQuantityThresholdBp / 10_000);

  const trail: AuditEntry[] = [];

  // Reconcile exceptions: new ones open, open ones no longer found close as fixed in the daily list.
  const current = await tx.select().from(exceptions).where(and(eq(exceptions.operationId, op.id), eq(exceptions.periodStart, start), inArray(exceptions.type, ['no_driver', 'unknown_name', 'no_pieces', 'low_pieces'])));
  const found = new Map(result.exceptions.map((e) => [exKey(e.type, e.date, idOf.get(e.route) ?? null), e]));
  const known = new Set(current.map((e) => exKey(e.type, e.date, e.routeId)));
  for (const [k, e] of found) {
    if (known.has(k)) continue;
    const rec = records.find((w) => w.date === e.date && w.routeId === idOf.get(e.route));
    const asg = assignments.find((a) => a.date === e.date && a.routeId === idOf.get(e.route));
    const [row] = await tx.insert(exceptions).values({
      operationId: op.id, periodStart: start, date: e.date, routeId: idOf.get(e.route)!, type: e.type,
      workRecordId: rec?.id ?? null, executionId: rec?.executionId ?? asg?.id ?? null, details: detailsOf(e),
    }).returning();
    trail.push({ table: 'exceptions', recordId: row!.id, action: 'insert', after: row, userId: null, source: 'system' });
  }
  for (const ex of current) {
    if (ex.status !== 'open' || found.has(exKey(ex.type, ex.date, ex.routeId))) continue;
    const [after] = await tx.update(exceptions).set({ status: 'resolved', resolution: 'assigned_driver', resolvedBy: actor.userId, resolvedAt: new Date() }).where(eq(exceptions.id, ex.id)).returning();
    trail.push({ table: 'exceptions', recordId: ex.id, action: 'update', before: ex, after, userId: actor.userId, source: actor.source });
  }
  await audit(tx, trail);
  // Who drove decides what is billed (a day with no payee isn't), so the week's expected payment follows the list.
  await refreshWeeklyLines(tx, actor, op.code, [start]);
  const open = (await tx.select({ id: exceptions.id }).from(exceptions).where(and(eq(exceptions.operationId, op.id), eq(exceptions.periodStart, start), eq(exceptions.status, 'open')))).length;
  return { open };
}

function detailsOf(e: CheckException) {
  switch (e.type) {
    case 'no_driver': return { pieces: e.pieces };
    case 'unknown_name': return { pieces: e.pieces, rawName: e.rawName };
    case 'no_pieces': return { payee: e.payee };
    case 'low_pieces': return { pieces: e.pieces, payee: e.payee, median: e.median, low: e.low, high: e.high };
  }
}

/** Re-check the week of `date` if T-Force already reported it (called after daily-list changes). */
export async function recheckForDate(tx: Tx, actor: Actor, date: string, operation?: string) {
  const op = await operationFor(tx, operation, 'daily_list');
  const [any] = await tx.select({ id: workView.id }).from(workView).where(and(eq(workView.operationId, op.id), eq(workView.source, 'client_report'), gte(workView.date, weekStart(date)), lte(workView.date, addDays(weekStart(date), 6)))).limit(1);
  if (any) await runWeeklyCheck(tx, actor, op.code, weekStart(date));
}

export type Resolution =
  | { action: 'assign'; payee: Exclude<PayeeInput, null> }
  | { action: 'not_ours' }
  | { action: 'pay_as_reported' }
  // The owner sets what the payee is paid for the day instead of what the client reported.
  | { action: 'pay_other'; payQuantity: number }
  // A claim to the client for `claimQuantity` pieces worth `claimCents`; the payee is paid `payQuantity` meanwhile.
  | { action: 'ask_client'; claimQuantity: number; claimCents?: number | null; payQuantity: number; note?: string | null };

const ALLOWED: Record<string, Resolution['action'][]> = {
  no_driver: ['assign', 'not_ours'],
  unknown_name: ['assign', 'not_ours'],
  low_pieces: ['pay_as_reported', 'pay_other', 'ask_client'],
  no_pieces: ['pay_other', 'ask_client', 'not_ours'],
};

export async function resolveTforceException(tx: Tx, actor: Actor, exceptionId: string, r: Resolution) {
  assertCan(actor, 'exceptions.clear');
  const [ex] = await tx.select().from(exceptions).where(eq(exceptions.id, exceptionId));
  if (!ex) throw new RuleError('not_found');
  const op = await getOperation(tx, (await tx.select({ code: operations.code }).from(operations).where(eq(operations.id, ex.operationId)))[0]!.code);
  if (ex.status !== 'open') throw new RuleError('already_resolved');
  if (!ALLOWED[ex.type]?.includes(r.action)) throw new RuleError('resolution_not_allowed');
  await assertNotLocked(tx, op, ex.date);

  if (r.action === 'assign') {
    // Fix it at the source: the daily list. The re-check then closes this exception.
    await assignRoute(tx, actor, { date: ex.date, routeId: ex.routeId!, payee: r.payee });
    await runWeeklyCheck(tx, actor, op.code, ex.periodStart);
    const [after] = await tx.select().from(exceptions).where(eq(exceptions.id, ex.id));
    if (after!.status === 'resolved') {
      await tx.update(exceptions).set({ resolvedBy: actor.userId }).where(eq(exceptions.id, ex.id));
      return after!;
    }
    throw new RuleError('still_open');
  }

  const code = (await tx.select({ code: routes.code }).from(routes).where(eq(routes.id, ex.routeId!)))[0]?.code ?? '';
  const extra: Record<string, unknown> = {};
  if (r.action === 'pay_other' || r.action === 'ask_client') {
    const basis = await claimBasis(tx, ex);
    const adj = await payQuantityFor(tx, actor, ex, basis, r.payQuantity, `${code} ${ex.date}: paid ${r.payQuantity} pieces, reported ${basis.reported}`);
    extra.payQuantity = r.payQuantity;
    if (adj) extra.payAdjustmentId = adj.id;
    if (r.action === 'ask_client') {
      const note = r.note?.trim() || null;
      const { line } = await openClaim(tx, actor, ex, basis, {
        claimQuantity: r.claimQuantity, claimCents: r.claimCents ?? null, note,
        reference: `${code} ${ex.date}: ${basis.reported} pieces reported, ${r.claimQuantity} claimed${note ? ` (${note})` : ''}`,
      });
      extra.settlementLineId = line.id;
      if (note) extra.note = note;
    }
  }
  // Not Aarisa's route: the execution has no payee (no driver or an unknown name), so nobody is paid for it.
  const resolution = r.action;
  const [after] = await tx.update(exceptions).set({
    status: 'resolved', resolution, resolvedBy: actor.userId, resolvedAt: new Date(),
    details: { ...(ex.details as object), ...extra },
  }).where(eq(exceptions.id, ex.id)).returning();
  await audit(tx, { table: 'exceptions', recordId: ex.id, action: 'update', before: ex, after, userId: actor.userId, source: actor.source });
  if (r.action === 'not_ours') await refreshWeeklyLines(tx, actor, op.code, [ex.periodStart]); // not billed any more
  return after!;
}

/** Everything the weekly check screen (6.4) and the phone Exceptions tab need. */
export async function loadTforceWeek(tx: Tx, actor: Actor, start: string, operation?: string) {
  assertCan(actor, 'payroll.view');
  const op = await operationFor(tx, operation, 'daily_list');
  const end = addDays(start, 6);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const routeRows = await tx.select().from(routes).where(eq(routes.operationId, op.id)).orderBy(asc(routes.code));
  const codeOf = new Map(routeRows.map((r) => [r.id, r.code]));
  const records = await tx.select().from(workView).where(and(eq(workView.operationId, op.id), eq(workView.source, 'client_report'), gte(workView.date, start), lte(workView.date, end)));
  const report: ReportRow[] = records.map((w) => ({ date: w.date, route: codeOf.get(w.routeId!)!, pieces: w.pieces }));
  const shownDays = days.filter((d, i) => i < 6 || report.some((r) => r.date === d)); // Sunday only if it has work

  const { driver: dName, contractor: cName } = await payeeNameMaps(tx);
  const owners = await routeOwners(tx, start, routeRows.map((r) => r.id));
  const payeeName = (p: { driverId?: string | null; contractorId?: string | null } | null | undefined) =>
    p?.driverId ? dName.get(p.driverId) ?? null : p?.contractorId ? cName.get(p.contractorId) ?? null : null;

  const exRows = await tx.select().from(exceptions).where(and(eq(exceptions.operationId, op.id), eq(exceptions.periodStart, start))).orderBy(asc(exceptions.date));
  const flagged = new Set(exRows.filter((e) => e.status === 'open').map((e) => `${codeOf.get(e.routeId!)}|${e.date}`));
  const grid = pieceGrid(report, shownDays).map((g) => {
    const rows = records.filter((w) => codeOf.get(w.routeId!) === g.route);
    const payees = new Set(rows.filter((w) => w.driverId || w.contractorId).map((w) => payeeName(w) ?? '?'));
    const missing = rows.filter((w) => !w.driverId && !w.contractorId).map((w) => w.date).sort()[0] ?? null;
    return {
      ...g,
      missingDay: missing,
      driver: payees.size === 1 && !missing ? [...payees][0]! : null, drivers: payees.size,
      contractorRoute: !!owners.get(routeRows.find((r) => r.code === g.route)?.id ?? ''),
      flags: shownDays.map((d) => flagged.has(`${g.route}|${d}`)),
    };
  });

  const imports = await tx.select().from(reportImports).where(and(eq(reportImports.operationId, op.id), lte(reportImports.periodStart, end), gte(reportImports.periodEnd, start))).orderBy(desc(reportImports.createdAt));
  const [lastImport] = await tx.select().from(reportImports).where(and(eq(reportImports.operationId, op.id), inArray(reportImports.status, ['done', 'partial']))).orderBy(desc(reportImports.receivedAt)).limit(1);
  const locked = (await lockedPeriodStarts(tx, op.id, start, end)).has(start);
  const open = exRows.filter((e) => e.status === 'open');
  // For open pieces exceptions: what was reported, the route's usual pieces and the rates, so the owner can
  // decide what to pay and what to claim. Client rates only for roles that see money (rule 9).
  const money = can(actor.role, 'money.view');
  const bases = new Map<string, { reported: number; usual: number; suggestedQuantity: number; clientRateCents: number | null; payeeRateCents: number | null; hasPayee: boolean }>();
  for (const e of open.filter((x) => x.type === 'low_pieces' || x.type === 'no_pieces')) {
    const b = await claimBasis(tx, e);
    bases.set(e.id, { reported: b.reported, usual: b.usual, suggestedQuantity: b.suggestedQuantity, clientRateCents: money ? b.clientRateCents : null, payeeRateCents: money ? b.payeeRateCents : null, hasPayee: !!b.execution?.payeeId });
  }

  return {
    week: { start, end }, days: shownDays, locked,
    canImport: can(actor.role, 'reports.import'),
    canResolve: can(actor.role, 'exceptions.clear') && !locked,
    canPayOther: can(actor.role, 'payroll.approve') && !locked,
    showMoney: money, // what a driver is paid beyond the report is the owner's call
    importState: imports[0] ? { status: imports[0].status, fileName: imports[0].fileName, receivedAt: imports[0].receivedAt?.toISOString() ?? null, channel: imports[0].channel, problems: (imports[0].problems ?? {}) as ImportProblems } : null,
    lastImportAt: lastImport?.receivedAt?.toISOString() ?? null,
    summary: {
      pieces: report.reduce((s, r) => s + r.pieces, 0),
      routes: new Set(report.map((r) => r.route)).size,
      routeDays: report.length,
      // Matched = has a payee from the daily list and nothing open on that day (design: "71 of 74").
      matched: records.filter((w) => (w.driverId || w.contractorId) && !flagged.has(`${codeOf.get(w.routeId!)}|${w.date}`)).length,
      contractorRouteDays: records.filter((w) => w.contractorId).length,
      contractorRoutes: [...new Set(records.filter((w) => w.contractorId).map((w) => codeOf.get(w.routeId!)!))].sort(),
      open: open.length,
    },
    dailyTotals: shownDays.map((d) => report.filter((r) => r.date === d).reduce((s, r) => s + r.pieces, 0)),
    grid,
    exceptions: exRows.map((e) => {
      const d = (e.details ?? {}) as { pieces?: number; rawName?: string; payee?: Payee | null; median?: number; low?: number; high?: number; note?: string };
      const neighbours = report.filter((r) => r.route === codeOf.get(e.routeId!));
      const before = neighbours.find((r) => r.date === addDays(e.date, -1))?.pieces ?? null;
      const after = neighbours.find((r) => r.date === addDays(e.date, 1))?.pieces ?? null;
      return {
        id: e.id, type: e.type, status: e.status, resolution: e.resolution, date: e.date, route: codeOf.get(e.routeId!) ?? '',
        pieces: d.pieces ?? null, rawName: d.rawName ?? null, payee: payeeName(d.payee ?? null), low: d.low ?? null, high: d.high ?? null,
        dayBefore: before, dayAfter: after, note: d.note ?? null, basis: bases.get(e.id) ?? null,
      };
    }),
    options: {
      drivers: [...dName].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)),
      contractors: [...cName].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)),
    },
    runId: `${op.code}-${start}`,
    operation: { code: op.code, name: op.name },
  };
}

/** Default week: the latest week T-Force reported, else this week. */
export async function latestTforceWeek(tx: Tx, today: string, operation?: string) {
  const op = await operationFor(tx, operation, 'daily_list');
  const [row] = await tx.select({ date: workView.date }).from(workView).where(and(eq(workView.operationId, op.id), eq(workView.source, 'client_report'))).orderBy(desc(workView.date)).limit(1);
  return weekStart(row?.date ?? today);
}

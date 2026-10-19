import { createHash } from 'node:crypto';
import { and, asc, desc, eq, gte, inArray, lt, lte } from 'drizzle-orm';
import type { Tx } from '~/db/client';
import { executionView, exceptions, reportImports, routes, settlementLines, workRecords, workView } from '~/db/schema';
import { addDays, weekStart } from '~/domain/dates';
import { can } from '~/domain/permissions';
import { crossCheck, pieceGrid, type CheckException, type ListEntry, type Payee, type ReportRow } from '~/domain/tforce';
import { parseTforce, type Field } from '~/integrations/tforce';
import { assertCan, type Actor } from './actor';
import { audit, type AuditEntry } from './audit';
import { assignRoute, type PayeeInput } from './daily';
import { RuleError } from './errors';
import { assertNotLocked, getOperation, lockedPeriodStarts, serviceIds } from './ops';
import { reportRouteDay } from './executions';
import { createRoute, payeeNameMaps, routeOwners } from './people';
import { saveImportFile } from './storage';
import { refreshWeeklyLines } from './settlements';
import type { ImportProblems } from './hovership';

// T-Force weekly check (spec §5.3, 6.4). Report rows become e-commerce work records; the check joins
// them to the daily list and keeps one exception per (type, date, route) until someone resolves it.

export type TforceImportOutcome =
  | { status: 'layout_changed'; importId: string; missing: Field[]; suggestions: { field: Field; header: string | null }[]; header: string[] }
  | { status: 'done' | 'partial'; importId: string; rows: number; pieces: number; weeks: string[]; newRoutes: string[]; badLines: { line: number; message: string }[]; openExceptions: number }
  | { status: 'failed'; reason: 'dates_already_imported' | 'no_rows'; dates?: string[] };

export async function importTforce(tx: Tx, actor: Actor, input: { fileName: string; text: string; columnOverride?: Partial<Record<Field, string>>; channel?: 'upload' | 'email' }): Promise<TforceImportOutcome> {
  assertCan(actor, 'reports.import');
  const op = await getOperation(tx, 'tforce');
  const sha = createHash('sha256').update(input.text).digest('hex');
  const [previous] = await tx.select().from(reportImports).where(and(eq(reportImports.operationId, op.id), eq(reportImports.fileSha256, sha)));
  if (previous && (previous.status === 'done' || previous.status === 'partial')) throw new RuleError('already_imported');

  const parsed = parseTforce(input.text, input.columnOverride);
  const fileUrl = await saveImportFile('tforce', sha, input.text);
  const base = { operationId: op.id, channel: input.channel ?? 'upload', fileName: input.fileName, fileSha256: sha, fileUrl, receivedAt: new Date(), createdBy: actor.userId };
  const save = async (values: Partial<typeof reportImports.$inferInsert> & { periodStart: string; periodEnd: string; status: typeof reportImports.$inferInsert.status }) => {
    if (previous) {
      const [row] = await tx.update(reportImports).set({ ...base, ...values }).where(eq(reportImports.id, previous.id)).returning();
      await audit(tx, { table: 'report_imports', recordId: row!.id, action: 'update', before: previous, after: row, userId: actor.userId, source: actor.source });
      return row!;
    }
    const [row] = await tx.insert(reportImports).values({ ...base, ...values }).returning();
    await audit(tx, { table: 'report_imports', recordId: row!.id, action: 'import', after: row, userId: actor.userId, source: actor.source });
    return row!;
  };

  if (parsed.kind === 'layout_changed') {
    const row = await save({ status: 'layout_changed', periodStart: '1970-01-01', periodEnd: '1970-01-01', problems: { missing: parsed.missing, suggestions: parsed.suggestions, header: parsed.header } });
    return { status: 'layout_changed', importId: row.id, missing: parsed.missing, suggestions: parsed.suggestions, header: parsed.header };
  }
  if (!parsed.rows.length) return { status: 'failed', reason: 'no_rows' };

  const dates = [...new Set(parsed.rows.map((r) => r.date))].sort();
  const already = await tx.selectDistinct({ date: workView.date }).from(workView)
    .where(and(eq(workView.operationId, op.id), eq(workView.source, 'tforce_report'), inArray(workView.date, dates)));
  if (already.length) return { status: 'failed', reason: 'dates_already_imported', dates: already.map((d) => d.date).sort() };
  for (const d of dates) await assertNotLocked(tx, op, d);

  const status = parsed.problems.length ? 'partial' : 'done';
  const imp = await save({ status, periodStart: dates[0]!, periodEnd: dates.at(-1)!, rowCount: parsed.rows.length, columnMap: parsed.columnMap, problems: { badLines: parsed.problems } satisfies ImportProblems });

  // A route letter we've never seen becomes a new route without a usual driver (the owner sets it up later).
  const trail: AuditEntry[] = [];
  const existing = await tx.select().from(routes).where(eq(routes.operationId, op.id));
  const routeId = new Map(existing.map((r) => [r.code, r.id]));
  const newRoutes: string[] = [];
  for (const code of new Set(parsed.rows.map((r) => r.route))) {
    if (routeId.has(code)) continue;
    const r = await createRoute(tx, actor, { operationId: op.id, code, contractorId: null, usualDriverId: null });
    routeId.set(code, r.id);
    newRoutes.push(code);
  }
  const ids = await serviceIds(tx, op.id);
  // Each report row lands on the execution of its route and day; a day the list never mentioned gets one without a driver.
  const values: (typeof workRecords.$inferInsert)[] = [];
  for (const r of parsed.rows) {
    const { row: ex, created } = await reportRouteDay(tx, { operationId: op.id, date: r.date, routeId: routeId.get(r.route)!, importId: imp.id });
    if (created) trail.push({ table: 'route_executions', recordId: ex.id, action: 'insert', after: ex, userId: actor.userId, source: actor.source });
    values.push({ executionId: ex.id, serviceTypeId: ids.ecommerce!, pieces: r.pieces, source: 'tforce_report', importId: imp.id });
  }
  const inserted = await tx.insert(workRecords).values(values).returning();
  for (const w of inserted) trail.push({ table: 'work_records', recordId: w.id, action: 'insert', after: w, userId: actor.userId, source: actor.source });
  await audit(tx, trail);

  const weeks = [...new Set(dates.map(weekStart))];
  let open = 0;
  for (const w of weeks) open += (await runWeeklyCheck(tx, actor, w)).open;
  await refreshWeeklyLines(tx, actor, 'tforce', weeks);
  return { status, importId: imp.id, rows: parsed.rows.length, pieces: parsed.rows.reduce((s, r) => s + r.pieces, 0), weeks, newRoutes, badLines: parsed.problems, openExceptions: open };
}

const exKey = (type: string, date: string, routeId: string | null) => `${type}|${date}|${routeId ?? ''}`;

/**
 * Re-runs the check for a week and reconciles exceptions. The payee of a report row is the payee of its
 * execution, so a daily-list change already moves the row. Runs after an import and after any
 * daily-list change in an imported week.
 */
export async function runWeeklyCheck(tx: Tx, actor: Actor, start: string) {
  const op = await getOperation(tx, 'tforce');
  const end = addDays(start, 6);
  const routeRows = await tx.select().from(routes).where(eq(routes.operationId, op.id));
  const codeOf = new Map(routeRows.map((r) => [r.id, r.code]));
  const idOf = new Map(routeRows.map((r) => [r.code, r.id]));

  const records = await tx.select().from(workView).where(and(eq(workView.operationId, op.id), eq(workView.source, 'tforce_report'), gte(workView.date, start), lte(workView.date, end)));
  if (!records.length) return { open: 0 };
  const history = await tx.select().from(workView).where(and(eq(workView.operationId, op.id), eq(workView.source, 'tforce_report'), gte(workView.date, addDays(start, -28)), lt(workView.date, start)));
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
export async function recheckForDate(tx: Tx, actor: Actor, date: string) {
  const op = await getOperation(tx, 'tforce');
  const [any] = await tx.select({ id: workView.id }).from(workView).where(and(eq(workView.operationId, op.id), eq(workView.source, 'tforce_report'), gte(workView.date, weekStart(date)), lte(workView.date, addDays(weekStart(date), 6)))).limit(1);
  if (any) await runWeeklyCheck(tx, actor, weekStart(date));
}

export type Resolution =
  | { action: 'assign'; payee: Exclude<PayeeInput, null> }
  | { action: 'not_ours' }
  | { action: 'pay_as_reported' }
  | { action: 'ask_client'; note?: string };

const ALLOWED: Record<string, Resolution['action'][]> = {
  no_driver: ['assign', 'not_ours'],
  unknown_name: ['assign', 'not_ours'],
  low_pieces: ['pay_as_reported', 'ask_client'],
  no_pieces: ['ask_client', 'not_ours'],
};

export async function resolveTforceException(tx: Tx, actor: Actor, exceptionId: string, r: Resolution) {
  assertCan(actor, 'exceptions.clear');
  const op = await getOperation(tx, 'tforce');
  const [ex] = await tx.select().from(exceptions).where(and(eq(exceptions.id, exceptionId), eq(exceptions.operationId, op.id)));
  if (!ex) throw new RuleError('not_found');
  if (ex.status !== 'open') throw new RuleError('already_resolved');
  if (!ALLOWED[ex.type]?.includes(r.action)) throw new RuleError('resolution_not_allowed');
  await assertNotLocked(tx, op, ex.date);

  if (r.action === 'assign') {
    // Fix it at the source: the daily list. The re-check then closes this exception.
    await assignRoute(tx, actor, { date: ex.date, routeId: ex.routeId!, payee: r.payee });
    await runWeeklyCheck(tx, actor, ex.periodStart);
    const [after] = await tx.select().from(exceptions).where(eq(exceptions.id, ex.id));
    if (after!.status === 'resolved') {
      await tx.update(exceptions).set({ resolvedBy: actor.userId }).where(eq(exceptions.id, ex.id));
      return after!;
    }
    throw new RuleError('still_open');
  }

  let claimId: string | null = null;
  if (r.action === 'ask_client') {
    const code = (await tx.select({ code: routes.code }).from(routes).where(eq(routes.id, ex.routeId!)))[0]?.code ?? '';
    const [line] = await tx.insert(settlementLines).values({
      operationId: op.id, kind: 'claim_adjustment', reference: `${code} ${ex.date} ${ex.type}${r.note ? `: ${r.note}` : ''}`,
      periodStart: ex.periodStart, periodEnd: addDays(ex.periodStart, 6), status: 'claim_ready',
    }).returning();
    await audit(tx, { table: 'settlement_lines', recordId: line!.id, action: 'insert', after: line, userId: actor.userId, source: actor.source });
    claimId = line!.id;
  }
  // Not Aarisa's route: the execution has no payee (no driver or an unknown name), so nobody is paid for it.
  const resolution = r.action === 'not_ours' ? 'not_ours' : r.action === 'pay_as_reported' ? 'pay_as_reported' : 'ask_client';
  const [after] = await tx.update(exceptions).set({
    status: 'resolved', resolution, resolvedBy: actor.userId, resolvedAt: new Date(),
    details: { ...(ex.details as object), ...(claimId ? { settlementLineId: claimId } : {}), ...(r.action === 'ask_client' && r.note ? { note: r.note } : {}) },
  }).where(eq(exceptions.id, ex.id)).returning();
  await audit(tx, { table: 'exceptions', recordId: ex.id, action: 'update', before: ex, after, userId: actor.userId, source: actor.source });
  if (r.action === 'not_ours') await refreshWeeklyLines(tx, actor, 'tforce', [ex.periodStart]); // not billed any more
  return after!;
}

/** Everything the weekly check screen (6.4) and the phone Exceptions tab need. */
export async function loadTforceWeek(tx: Tx, actor: Actor, start: string) {
  assertCan(actor, 'payroll.view');
  const op = await getOperation(tx, 'tforce');
  const end = addDays(start, 6);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const routeRows = await tx.select().from(routes).where(eq(routes.operationId, op.id)).orderBy(asc(routes.code));
  const codeOf = new Map(routeRows.map((r) => [r.id, r.code]));
  const records = await tx.select().from(workView).where(and(eq(workView.operationId, op.id), eq(workView.source, 'tforce_report'), gte(workView.date, start), lte(workView.date, end)));
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

  return {
    week: { start, end }, days: shownDays, locked,
    canImport: can(actor.role, 'reports.import'),
    canResolve: can(actor.role, 'exceptions.clear') && !locked,
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
        dayBefore: before, dayAfter: after, note: d.note ?? null,
      };
    }),
    options: {
      drivers: [...dName].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)),
      contractors: [...cName].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)),
    },
    runId: `tforce-${start}`,
  };
}

/** Default week: the latest week T-Force reported, else this week. */
export async function latestTforceWeek(tx: Tx, today: string) {
  const op = await getOperation(tx, 'tforce');
  const [row] = await tx.select({ date: workView.date }).from(workView).where(and(eq(workView.operationId, op.id), eq(workView.source, 'tforce_report'))).orderBy(desc(workView.date)).limit(1);
  return weekStart(row?.date ?? today);
}

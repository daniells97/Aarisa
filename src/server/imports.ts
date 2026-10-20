import { createHash } from 'node:crypto';
import { and, asc, eq, inArray } from 'drizzle-orm';
import type { Tx } from '~/db/client';
import { exceptions, operations, otherRevenues, reportImportRows, reportImports, reportLayoutColumns, reportLayouts, revenueTypes, routes, workRecords, workView } from '~/db/schema';
import { todayLA, weekStart } from '~/domain/dates';
import { periodFor } from '~/domain/periods';
import { parseWithLayout, type LayoutColumn, type ReportRow, type Suggestion } from '~/integrations/layout';
import { setManualBonus } from './adjustments';
import { assertCan, type Actor } from './actor';
import { audit, type AuditEntry } from './audit';
import { RuleError } from './errors';
import { driverDay, reportRouteDay } from './executions';
import { refreshImportStatus } from './import-status';
import { assertNotLocked, getOperation, type Operation } from './ops';
import { createDriver, createRoute, driverIdsByCode, driverProfile, setHovershipCode } from './people';
import { recordOtherRevenue, zoneLookup } from './revenue';
import { refreshWeeklyLines } from './settlements';
import { saveImportFile } from './storage';
import { runWeeklyCheck } from './tforce';
import { counts, value, valuationContext } from './valuation';

// Reads any client's report with its saved layout and turns it into executions and work (stage 6c of the
// redesign). Clients whose report names the driver (driver_source = report_code) get one execution per
// driver and day; unknown codes wait as exceptions. Clients whose drivers come from Aarisa's daily list
// get one execution per route and day, joined to the list by the weekly check.

export type ImportOutcome =
  | { status: 'layout_changed'; importId: string; missing: string[]; suggestions: Suggestion[]; header: string[] }
  | {
    status: 'done' | 'partial'; importId: string; rows: number; pieces: number; weeks: string[]; newRoutes: string[];
    badLines: { line: number; message: string }[]; unknownCodes: { code: string; name: string; days: number; packages: number }[];
    totalsMismatch: number[]; stemToReview: number; openExceptions: number;
  }
  | { status: 'failed'; reason: 'dates_already_imported' | 'no_rows'; dates?: string[] };

export interface ImportProblems {
  badLines?: { line: number; message: string }[];
  unknownCodes?: string[];
  totalsMismatch?: number[];
  stemToReview?: number;
  missing?: string[];
  suggestions?: Suggestion[];
  header?: string[];
}

/** Rows of an unknown driver code, kept on its exception until someone says who it is. */
export interface UnknownDetails { code: string; name: string; importId: string; rows: ReportRow[] }

/** The active layout of an operation, as the reader wants it. */
export async function activeLayout(tx: Tx, operationId: string): Promise<LayoutColumn[]> {
  const [layout] = await tx.select().from(reportLayouts).where(and(eq(reportLayouts.operationId, operationId), eq(reportLayouts.active, true)));
  if (!layout) throw new RuleError('no_layout');
  const cols = await tx.select().from(reportLayoutColumns).where(eq(reportLayoutColumns.layoutId, layout.id)).orderBy(asc(reportLayoutColumns.sortOrder));
  return cols.map((c) => ({
    id: c.id, sourceName: c.sourceName, aliases: c.aliases, meaning: c.meaning, required: c.required,
    serviceTypeId: c.serviceTypeId, tierId: c.tierId, revenueTypeId: c.revenueTypeId,
  }));
}

const pieceCount = (row: ReportRow) => Object.values(row.quantities).reduce((s, n) => s + n, 0);

/** Pieces of a row as (service, tier, quantity), dropping zeros except when the row has nothing else. */
function piecesOf(row: ReportRow, columns: LayoutColumn[]) {
  const qty = columns.filter((c) => c.meaning === 'quantity' && row.quantities[c.id] != null);
  const pieces = qty.map((c) => ({ serviceTypeId: c.serviceTypeId!, tierId: c.tierId, quantity: row.quantities[c.id]!, column: c.id }));
  const nonZero = pieces.filter((p) => p.quantity > 0);
  // A route-day the client reported with 0 pieces is still a reported day (the weekly check flags it).
  return nonZero.length ? nonZero : pieces.slice(0, 1);
}

interface WriteContext { op: Operation; importId: string; columns: LayoutColumn[]; rowIds: Map<number, string> }

/** Work, bonus and other revenue of one report row, on its execution. */
async function writeRow(tx: Tx, actor: Actor, ctx: WriteContext, executionId: string, payeeId: string | null, row: ReportRow, zoneOf: Map<string, string>, trail: AuditEntry[]) {
  const values = piecesOf(row, ctx.columns).map((p) => ({
    executionId, serviceTypeId: p.serviceTypeId, tierId: p.tierId, pieces: p.quantity, source: 'client_report' as const, importId: ctx.importId,
    importRowId: ctx.rowIds.get(row.lines[0]!) ?? null,
  }));
  const inserted = values.length ? await tx.insert(workRecords).values(values).returning() : [];
  for (const w of inserted) trail.push({ table: 'work_records', recordId: w.id, action: 'insert', after: w, userId: actor.userId, source: actor.source });
  // A bonus column only exists in Aarisa's own workbook; it starts as a manual bonus.
  if (row.bonusCents && payeeId) await setManualBonus(tx, actor, { executionId, payeeId, amountCents: row.bonusCents, reason: 'From the imported file' });
  // STEM and similar: the client's revenue, never driver pay (rule 7).
  for (const c of ctx.columns.filter((x) => x.meaning === 'other_revenue')) {
    const cents = row.otherRevenue[c.id];
    if (!cents) continue;
    const [type] = await tx.select({ code: revenueTypes.code }).from(revenueTypes).where(eq(revenueTypes.id, c.revenueTypeId!));
    const s = await recordOtherRevenue(tx, { operationId: ctx.op.id, date: row.date, typeCode: type!.code, executionId, reason: row.otherRevenueReason, amountCents: cents, importId: ctx.importId }, zoneOf);
    trail.push({ table: 'other_revenues', recordId: s.id, action: 'insert', after: s, userId: actor.userId, source: actor.source });
  }
}

/** Rows of one known driver (report_code clients). */
async function writeDriverRows(tx: Tx, actor: Actor, ctx: WriteContext, driverId: string, rows: ReportRow[]) {
  const trail: AuditEntry[] = [];
  const zoneOf = await zoneLookup(tx);
  for (const r of rows) {
    const { row: ex, created } = await driverDay(tx, { operationId: ctx.op.id, date: r.date, driverId, importId: ctx.importId });
    if (created) trail.push({ table: 'route_executions', recordId: ex.id, action: 'insert', after: ex, userId: actor.userId, source: actor.source });
    await writeRow(tx, actor, ctx, ex.id, ex.payeeId, r, zoneOf, trail);
  }
  await audit(tx, trail);
}

export async function importReport(tx: Tx, actor: Actor, input: {
  operation: string; fileName: string; text: string; columnOverride?: Record<string, string>; channel?: 'upload' | 'email';
}): Promise<ImportOutcome> {
  assertCan(actor, 'reports.import');
  const op = await getOperation(tx, input.operation);
  const columns = await activeLayout(tx, op.id);
  const sha = createHash('sha256').update(input.text).digest('hex');
  const [previous] = await tx.select().from(reportImports).where(and(eq(reportImports.operationId, op.id), eq(reportImports.fileSha256, sha)));
  if (previous && (previous.status === 'done' || previous.status === 'partial')) throw new RuleError('already_imported');

  const byDriver = op.driverSource === 'report_code';
  const parsed = parseWithLayout(input.text, columns, byDriver ? 'driver_code' : 'route_code', input.columnOverride);
  const fileUrl = await saveImportFile(op.code, sha, input.text);
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
    // Nothing else is saved: last week's numbers stay untouched.
    const row = await save({ status: 'layout_changed', periodStart: '1970-01-01', periodEnd: '1970-01-01', problems: { missing: parsed.missing, suggestions: parsed.suggestions, header: parsed.header } satisfies ImportProblems });
    return { status: 'layout_changed', importId: row.id, missing: parsed.missing, suggestions: parsed.suggestions, header: parsed.header };
  }
  if (!parsed.rows.length) return { status: 'failed', reason: 'no_rows' };

  const dates = [...new Set(parsed.rows.map((r) => r.date))].sort();
  const already = await tx.selectDistinct({ date: workView.date }).from(workView)
    .where(and(eq(workView.operationId, op.id), eq(workView.source, 'client_report'), inArray(workView.date, dates)));
  if (already.length) return { status: 'failed', reason: 'dates_already_imported', dates: already.map((d) => d.date).sort() };
  for (const d of dates) await assertNotLocked(tx, op, d);

  // Driver codes the portal doesn't know wait as exceptions; their rows join payroll once someone says who it is.
  const idByCode = byDriver ? await driverIdsByCode(tx, op.id) : new Map<string, string>();
  const unknown = new Map<string, ReportRow[]>();
  if (byDriver) for (const r of parsed.rows) if (!idByCode.has(r.driverCode!)) unknown.set(r.driverCode!, [...(unknown.get(r.driverCode!) ?? []), r]);

  // The file's own pay totals (Aarisa's workbook) against the portal's rates: catches a rate we don't know about.
  const vctx = await valuationContext(tx, op.id);
  const totalsMismatch = byDriver ? parsed.rows.filter((r) => {
    if (r.expectedPayCents == null || !idByCode.has(r.driverCode!)) return false;
    const v = value(vctx, piecesOf(r, columns), null, r.date);
    return !v.missing && v.payCents + r.bonusCents !== r.expectedPayCents;
  }).flatMap((r) => r.lines) : [];

  const status = unknown.size || parsed.problems.length ? 'partial' as const : 'done' as const;
  const imp = await save({
    status, periodStart: dates[0]!, periodEnd: dates.at(-1)!, rowCount: parsed.rows.length, columnMap: parsed.columnMap,
    problems: { badLines: parsed.problems, unknownCodes: [...unknown.keys()], totalsMismatch } satisfies ImportProblems,
  });

  // Every line of the file as it arrived, so a record can be traced to its line (stage 6b).
  const rowIds = new Map<number, string>();
  const unknownLines = new Set([...unknown.values()].flat().flatMap((r) => r.lines));
  for (let i = 0; i < parsed.raw.length; i += 500) {
    const chunk = parsed.raw.slice(i, i + 500).map((r) => ({
      importId: imp.id, rowNumber: r.line, rawData: r.data,
      status: r.problem ? 'error' as const : unknownLines.has(r.line) ? 'warning' as const : 'ok' as const,
      problemCode: r.problem ? 'unreadable' : unknownLines.has(r.line) ? 'unknown_driver_code' : null, problemText: r.problem,
    }));
    for (const row of await tx.insert(reportImportRows).values(chunk).returning({ id: reportImportRows.id, line: reportImportRows.rowNumber })) rowIds.set(row.line, row.id);
  }

  const ctx: WriteContext = { op, importId: imp.id, columns, rowIds };
  const newRoutes: string[] = [];
  if (byDriver) {
    const rowsByDriver = new Map<string, ReportRow[]>();
    for (const r of parsed.rows) {
      const id = idByCode.get(r.driverCode!);
      if (id) rowsByDriver.set(id, [...(rowsByDriver.get(id) ?? []), r]);
    }
    for (const [driverId, rows] of rowsByDriver) await writeDriverRows(tx, actor, ctx, driverId, rows);
    for (const [code, rows] of unknown) {
      const details: UnknownDetails = { code, name: rows.find((r) => r.driverName)?.driverName ?? '', importId: imp.id, rows };
      const first = rows[0]!.date;
      const [ex] = await tx.insert(exceptions).values({
        operationId: op.id, periodStart: periodFor(op.cycleAnchor, op.payCycle, first).start, date: first, type: 'unknown_driver_code', details,
      }).returning();
      await audit(tx, { table: 'exceptions', recordId: ex!.id, action: 'insert', after: ex, userId: actor.userId, source: 'system' });
    }
  } else {
    // A route code never seen before becomes a new route without a usual driver (the owner sets it up later).
    const routeId = new Map((await tx.select().from(routes).where(eq(routes.operationId, op.id))).map((r) => [r.code, r.id]));
    for (const code of new Set(parsed.rows.map((r) => r.routeCode!))) {
      if (routeId.has(code)) continue;
      const r = await createRoute(tx, actor, { operationId: op.id, code, contractorId: null, usualDriverId: null });
      routeId.set(code, r.id);
      newRoutes.push(code);
    }
    const trail: AuditEntry[] = [];
    const zoneOf = await zoneLookup(tx);
    // Each row lands on the execution of its route and day; a day the list never mentioned gets one without a driver.
    for (const r of parsed.rows) {
      const { row: ex, created } = await reportRouteDay(tx, { operationId: op.id, date: r.date, routeId: routeId.get(r.routeCode!)!, importId: imp.id });
      if (created) trail.push({ table: 'route_executions', recordId: ex.id, action: 'insert', after: ex, userId: actor.userId, source: actor.source });
      await writeRow(tx, actor, ctx, ex.id, ex.payeeId, r, zoneOf, trail);
    }
    await audit(tx, trail);
  }

  // Other revenue with no known zone or an unusual amount keeps the import partly read until classified.
  const stemToReview = (await tx.select({ id: otherRevenues.id }).from(otherRevenues)
    .where(and(eq(otherRevenues.importId, imp.id), eq(otherRevenues.status, 'needs_review')))).length;
  let finalStatus: 'done' | 'partial' = status;
  if (stemToReview) {
    finalStatus = 'partial';
    const [after] = await tx.update(reportImports).set({ status: 'partial', problems: { ...(imp.problems as ImportProblems), stemToReview } }).where(eq(reportImports.id, imp.id)).returning();
    await audit(tx, { table: 'report_imports', recordId: imp.id, action: 'update', before: imp, after, userId: actor.userId, source: actor.source });
  }

  const weeks = [...new Set(dates.map(weekStart))];
  let open = 0;
  if (!byDriver) for (const w of weeks) open += (await runWeeklyCheck(tx, actor, op.code, w)).open;
  await refreshWeeklyLines(tx, actor, op.code, weeks);
  return {
    status: finalStatus, importId: imp.id, rows: parsed.rows.length, pieces: parsed.rows.reduce((s, r) => s + pieceCount(r), 0), weeks, newRoutes,
    badLines: parsed.problems, totalsMismatch, stemToReview, openExceptions: open,
    unknownCodes: [...unknown].map(([code, rows]) => ({ code, name: rows.find((r) => r.driverName)?.driverName ?? '', days: rows.length, packages: rows.reduce((s, r) => s + counts(vctx, piecesOf(r, columns)).packages, 0) })),
  };
}

/** Exceptions saved before the generic reader kept Hovership rows as t1…t4, stat, stem and bonus. */
function legacyRows(rows: unknown[], columns: LayoutColumn[]): ReportRow[] {
  const col = (name: string) => columns.find((c) => c.sourceName === name)?.id;
  return rows.map((x) => {
    const r = x as Partial<ReportRow> & { line?: number; t1?: number; t2?: number; t3?: number; t4?: number; stat?: number; stemCents?: number; stemReason?: string | null; bonusCents?: number; driverCode?: string; driverName?: string; date: string };
    if (r.quantities) return r as ReportRow;
    const q: Record<string, number> = {};
    for (const [name, n] of [['Tier 1', r.t1], ['Tier 2', r.t2], ['Tier 3', r.t3], ['Tier 4', r.t4], ['Stat', r.stat]] as const) if (col(name)) q[col(name)!] = n ?? 0;
    return {
      lines: [r.line ?? 0], date: r.date, driverCode: r.driverCode ?? null, driverName: r.driverName ?? null, routeCode: null, quantities: q,
      bonusCents: r.bonusCents ?? 0, otherRevenue: col('Stem') && r.stemCents ? { [col('Stem')!]: r.stemCents } : {}, otherRevenueReason: r.stemReason ?? null, expectedPayCents: null,
    };
  });
}

export type CodeResolution = { action: 'new_driver'; fullName: string } | { action: 'match'; driverId: string };

/** Partly read import: say who an unknown driver code is, and its rows join payroll. */
export async function resolveUnknownCode(tx: Tx, actor: Actor, exceptionId: string, resolution: CodeResolution) {
  assertCan(actor, 'exceptions.clear');
  const [ex] = await tx.select().from(exceptions).where(eq(exceptions.id, exceptionId));
  if (!ex || ex.type !== 'unknown_driver_code') throw new RuleError('not_found');
  if (ex.status !== 'open') throw new RuleError('already_resolved');
  const details = ex.details as UnknownDetails;
  const op = await getOperationById(tx, ex.operationId);
  const columns = await activeLayout(tx, op.id);
  const rows = legacyRows(details.rows, columns);
  for (const r of rows) await assertNotLocked(tx, op, r.date);

  let driverId: string;
  if (resolution.action === 'new_driver') {
    const name = resolution.fullName.trim() || details.name;
    if (!name) throw new RuleError('name_required');
    // Created from an import: the owner finishes phone, contractor and aliases in Drivers and rates.
    const d = await createDriver(tx, actor, { fullName: name, hovershipCode: details.code, contractorId: null, phone: null, aliases: [], active: true, setupComplete: false }, todayLA());
    driverId = d.id;
  } else {
    const d = await driverProfile(tx, resolution.driverId, todayLA());
    if (!d) throw new RuleError('not_found');
    if (!d.hovershipCode) await setHovershipCode(tx, actor, d.id, details.code, todayLA());
    driverId = d.id;
  }
  await writeDriverRows(tx, actor, { op, importId: details.importId, columns, rowIds: new Map() }, driverId, rows);
  const [after] = await tx.update(exceptions).set({ status: 'resolved', resolution: 'assigned_driver', resolvedBy: actor.userId, resolvedAt: new Date() })
    .where(eq(exceptions.id, ex.id)).returning();
  await audit(tx, { table: 'exceptions', recordId: ex.id, action: 'update', before: ex, after, userId: actor.userId, source: actor.source });
  await refreshImportStatus(tx, actor, details.importId);
  await refreshWeeklyLines(tx, actor, op.code, [...new Set(rows.map((r) => weekStart(r.date)))]);
  return { driverId };
}

async function getOperationById(tx: Tx, operationId: string) {
  const [row] = await tx.select({ code: operations.code }).from(operations).where(eq(operations.id, operationId));
  if (!row) throw new RuleError('operation_missing');
  return getOperation(tx, row.code);
}

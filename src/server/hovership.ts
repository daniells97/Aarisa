import { createHash } from 'node:crypto';
import { and, asc, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import type { Tx } from '~/db/client';
import { executionView, exceptions, otherRevenues, reportImports, workRecords, workView } from '~/db/schema';
import { addDays, todayLA, weekStart } from '~/domain/dates';
import { hovershipSummary, type HovershipDay } from '~/domain/hovership';
import { can } from '~/domain/permissions';
import { periodFor } from '~/domain/periods';
import { parseHovership, type Field, type HovershipRow } from '~/integrations/hovership';
import { assertCan, type Actor } from './actor';
import { audit, type AuditEntry } from './audit';
import { RuleError } from './errors';
import { assertNotLocked, getOperation, hovershipRateFn, lockedPeriodStarts, serviceIds, tierIdsByCode } from './ops';
import { adjustmentsByExecution, setManualBonus } from './adjustments';
import { driverDay } from './executions';
import { createDriver, driverIdsByCode, driverProfile, driverProfiles, setHovershipCode } from './people';
import { otherRevenueTotal, recordOtherRevenue, revenueToReview, zoneLookup, zoneOptions } from './revenue';
import { refreshImportStatus } from './import-status';
import { saveImportFile } from './storage';
import { refreshWeeklyLines } from './settlements';

export type ImportOutcome =
  | { status: 'layout_changed'; importId: string; missing: Field[]; suggestions: { field: Field; header: string | null }[]; header: string[] }
  | { status: 'done' | 'partial'; importId: string; rows: number; unknownCodes: { code: string; name: string; days: number; packages: number }[]; badLines: { line: number; message: string }[]; totalsMismatch: number[]; stemToReview: number }
  | { status: 'failed'; reason: 'dates_already_imported' | 'no_rows'; dates?: string[] };

export interface ImportProblems {
  badLines?: { line: number; message: string }[];
  unknownCodes?: string[];
  totalsMismatch?: number[];
  stemToReview?: number;
  missing?: string[];
  suggestions?: { field: string; header: string | null }[];
  header?: string[];
}

interface UnknownDetails { code: string; name: string; importId: string; rows: HovershipRow[] }

/** Inserts the work records and STEM revenue for rows of one known driver. */
async function writeRows(tx: Tx, actor: Actor, ctx: { operationId: string; importId: string; ids: Record<string, string> }, driverId: string, rows: HovershipRow[]) {
  const trail: AuditEntry[] = [];
  const tiers = await tierIdsByCode(tx, ctx.ids.hovership_packages!);
  const zoneOf = await zoneLookup(tx);
  for (const r of rows) {
    const { row: ex, created } = await driverDay(tx, { operationId: ctx.operationId, date: r.date, driverId, importId: ctx.importId });
    if (created) trail.push({ table: 'route_executions', recordId: ex.id, action: 'insert', after: ex, userId: actor.userId, source: actor.source });
    const base = { executionId: ex.id, source: 'hovership_report' as const, importId: ctx.importId };
    // One row per tier as the report has it (premise 2); tiers with no pieces aren't stored.
    const records = [
      ...([['T1', r.t1], ['T2', r.t2], ['T3', r.t3], ['T4', r.t4]] as const).filter(([, n]) => n > 0)
        .map(([code, n]) => ({ ...base, serviceTypeId: ctx.ids.hovership_packages!, tierId: tiers.get(code)!, pieces: n })),
      ...(r.stat ? [{ ...base, serviceTypeId: ctx.ids.stat!, pieces: r.stat }] : []),
    ];
    const inserted = records.length ? await tx.insert(workRecords).values(records).returning() : [];
    for (const w of inserted) trail.push({ table: 'work_records', recordId: w.id, action: 'insert', after: w, userId: actor.userId, source: actor.source });
    // A bonus only comes in Aarisa's own workbook (the client report has none); it starts as a manual bonus.
    if (r.bonusCents) await setManualBonus(tx, actor, { executionId: ex.id, payeeId: ex.payeeId!, amountCents: r.bonusCents, reason: 'From the imported file' });
    // STEM: Aarisa's revenue, never driver pay (rule 7). It keeps the driver-day it came with and its zone.
    if (r.stemCents) {
      const s = await recordOtherRevenue(tx, { operationId: ctx.operationId, date: r.date, typeCode: 'stem', executionId: ex.id, reason: r.stemReason, amountCents: r.stemCents, importId: ctx.importId }, zoneOf);
      trail.push({ table: 'other_revenues', recordId: s.id, action: 'insert', after: s, userId: actor.userId, source: actor.source });
    }
  }
  await audit(tx, trail);
}

export async function importHovership(tx: Tx, actor: Actor, input: { fileName: string; text: string; columnOverride?: Partial<Record<Field, string>>; channel?: 'upload' | 'email' }): Promise<ImportOutcome> {
  assertCan(actor, 'reports.import');
  const op = await getOperation(tx, 'hovership');
  const sha = createHash('sha256').update(input.text).digest('hex');
  const [previous] = await tx.select().from(reportImports).where(and(eq(reportImports.operationId, op.id), eq(reportImports.fileSha256, sha)));
  if (previous && (previous.status === 'done' || previous.status === 'partial')) throw new RuleError('already_imported');

  const parsed = parseHovership(input.text, input.columnOverride);
  const fileUrl = await saveImportFile('hovership', sha, input.text);
  const importValues = {
    operationId: op.id, channel: input.channel ?? 'upload', fileName: input.fileName, fileSha256: sha, fileUrl,
    receivedAt: new Date(), createdBy: actor.userId,
  };
  const saveImport = async (values: Partial<typeof reportImports.$inferInsert> & { periodStart: string; periodEnd: string; status: typeof reportImports.$inferInsert.status }) => {
    if (previous) {
      const [row] = await tx.update(reportImports).set({ ...importValues, ...values }).where(eq(reportImports.id, previous.id)).returning();
      await audit(tx, { table: 'report_imports', recordId: row!.id, action: 'update', before: previous, after: row, userId: actor.userId, source: actor.source });
      return row!;
    }
    const [row] = await tx.insert(reportImports).values({ ...importValues, ...values }).returning();
    await audit(tx, { table: 'report_imports', recordId: row!.id, action: 'import', after: row, userId: actor.userId, source: actor.source });
    return row!;
  };

  if (parsed.kind === 'layout_changed') {
    // Nothing else is saved: last week's numbers stay untouched.
    const row = await saveImport({ status: 'layout_changed', periodStart: '1970-01-01', periodEnd: '1970-01-01', problems: { missing: parsed.missing, suggestions: parsed.suggestions, header: parsed.header } });
    return { status: 'layout_changed', importId: row.id, missing: parsed.missing, suggestions: parsed.suggestions, header: parsed.header };
  }
  if (!parsed.rows.length) return { status: 'failed', reason: 'no_rows' };

  const dates = [...new Set(parsed.rows.map((r) => r.date))].sort();
  const already = await tx.selectDistinct({ date: workView.date }).from(workView).where(and(
    eq(workView.operationId, op.id), eq(workView.source, 'hovership_report'), inArray(workView.date, dates)));
  if (already.length) return { status: 'failed', reason: 'dates_already_imported', dates: already.map((d) => d.date).sort() };

  // Driver codes: known → records now; unknown → one exception per code holding its rows.
  const codes = [...new Set(parsed.rows.map((r) => r.driverCode))];
  const byCode = await driverIdsByCode(tx, op.id);
  const idByCode = new Map(codes.filter((c) => byCode.has(c)).map((c) => [c, byCode.get(c)!]));
  const unknown = new Map<string, HovershipRow[]>();
  for (const r of parsed.rows) if (!idByCode.has(r.driverCode)) unknown.set(r.driverCode, [...(unknown.get(r.driverCode) ?? []), r]);

  // Cross-check the report's own totals against the portal's rates (catches a rate change we don't know about).
  const { fn: rate, ids } = await hovershipRateFn(tx, op.id);
  const totalsMismatch = parsed.rows.filter((r) => {
    if (r.totalRouteCents == null) return false;
    const counts = { T1: r.t1, T2: r.t2, T3: r.t3, T4: r.t4, stat: r.stat };
    const v = hovershipSummary([{ date: r.date, driverId: idByCode.get(r.driverCode) ?? '', t13: r.t1 + r.t2 + r.t3, t4: r.t4, stat: r.stat, bonusCents: r.bonusCents, counts }], 0, rate).days[0]!;
    return v.missing.length === 0 && v.driverPayCents !== r.totalRouteCents;
  }).map((r) => r.line);

  const status = unknown.size || parsed.problems.length ? 'partial' : 'done';
  const row = await saveImport({
    status, periodStart: dates[0]!, periodEnd: dates.at(-1)!, rowCount: parsed.rows.length, columnMap: parsed.columnMap,
    problems: { badLines: parsed.problems, unknownCodes: [...unknown.keys()], totalsMismatch },
  });

  const ctx = { operationId: op.id, importId: row.id, ids };
  const byDriver = new Map<string, HovershipRow[]>();
  for (const r of parsed.rows) {
    const id = idByCode.get(r.driverCode);
    if (id) byDriver.set(id, [...(byDriver.get(id) ?? []), r]);
  }
  for (const [driverId, rows] of byDriver) await writeRows(tx, actor, ctx, driverId, rows);

  for (const [code, rows] of unknown) {
    const details: UnknownDetails = { code, name: rows.find((r) => r.driverName)?.driverName ?? '', importId: row.id, rows };
    const first = rows[0]!.date;
    const [ex] = await tx.insert(exceptions).values({
      operationId: op.id, periodStart: periodFor(op.cycleAnchor, op.payCycle, first).start, date: first, type: 'unknown_driver_code', details,
    }).returning();
    await audit(tx, { table: 'exceptions', recordId: ex!.id, action: 'insert', after: ex, userId: actor.userId, source: 'system' });
  }

  // STEM with no known zone or an unusual amount keeps the import partly read until someone classifies it.
  const stemToReview = (await tx.select({ id: otherRevenues.id }).from(otherRevenues)
    .where(and(eq(otherRevenues.importId, row.id), eq(otherRevenues.status, 'needs_review')))).length;
  let finalStatus: 'done' | 'partial' = status;
  if (stemToReview) {
    finalStatus = 'partial';
    const [after] = await tx.update(reportImports).set({ status: 'partial', problems: { ...(row.problems as ImportProblems), stemToReview } }).where(eq(reportImports.id, row.id)).returning();
    await audit(tx, { table: 'report_imports', recordId: row.id, action: 'update', before: row, after, userId: actor.userId, source: actor.source });
  }

  await refreshWeeklyLines(tx, actor, 'hovership', [...new Set(dates.map(weekStart))]);
  return {
    status: finalStatus, importId: row.id, rows: parsed.rows.length, badLines: parsed.problems, totalsMismatch, stemToReview,
    unknownCodes: [...unknown].map(([code, rows]) => ({ code, name: rows.find((r) => r.driverName)?.driverName ?? '', days: rows.length, packages: rows.reduce((s, r) => s + r.t1 + r.t2 + r.t3 + r.t4, 0) })),
  };
}

export type CodeResolution = { action: 'new_driver'; fullName: string } | { action: 'match'; driverId: string };

/** Partly read state: say who an unknown code is, and its rows join payroll. */
export async function resolveUnknownCode(tx: Tx, actor: Actor, exceptionId: string, resolution: CodeResolution) {
  assertCan(actor, 'exceptions.clear');
  const [ex] = await tx.select().from(exceptions).where(eq(exceptions.id, exceptionId));
  if (!ex || ex.type !== 'unknown_driver_code') throw new RuleError('not_found');
  if (ex.status !== 'open') throw new RuleError('already_resolved');
  const details = ex.details as UnknownDetails;
  const op = await getOperation(tx, 'hovership');
  for (const r of details.rows) await assertNotLocked(tx, op, r.date);

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

  const ids = await serviceIds(tx, op.id);
  await writeRows(tx, actor, { operationId: op.id, importId: details.importId, ids }, driverId, details.rows);
  const [after] = await tx.update(exceptions).set({ status: 'resolved', resolution: 'assigned_driver', resolvedBy: actor.userId, resolvedAt: new Date() })
    .where(eq(exceptions.id, ex.id)).returning();
  await audit(tx, { table: 'exceptions', recordId: ex.id, action: 'update', before: ex, after, userId: actor.userId, source: actor.source });
  await refreshImportStatus(tx, actor, details.importId);
  await refreshWeeklyLines(tx, actor, 'hovership', [...new Set(details.rows.map((r) => weekStart(r.date)))]);
  return { driverId };
}


/** Bonus is typed per driver per day; it sits on that day's Tier 1–3 record. */
export async function setBonus(tx: Tx, actor: Actor, input: { driverId: string; date: string; bonusCents: number }) {
  assertCan(actor, 'hovership.enter_bonus');
  const op = await getOperation(tx, 'hovership');
  await assertNotLocked(tx, op, input.date);
  if (input.bonusCents < 0) throw new RuleError('invalid_amount');
  // The bonus belongs to the driver's execution of that day (docs/db-model.md: pay_adjustments).
  const [day] = await tx.select().from(executionView).where(and(
    eq(executionView.operationId, op.id), eq(executionView.payeeDriverId, input.driverId), eq(executionView.date, input.date), eq(executionView.kind, 'route')));
  if (!day) throw new RuleError('not_found');
  const { before, after } = await setManualBonus(tx, actor, { executionId: day.id, payeeId: day.payeeId!, amountCents: input.bonusCents });
  return { id: (after ?? before)?.id ?? day.id, bonusCents: after?.amountCents ?? 0 };
}

/** Driver-days and STEM for a date range, rebuilt from the work records. */
export async function loadHovershipDays(tx: Tx, operationId: string, ids: Record<string, string>, from: string, to: string) {
  const records = await tx.select().from(workView).where(and(eq(workView.operationId, operationId), gte(workView.date, from), lte(workView.date, to)));
  const executions = await tx.select().from(executionView).where(and(eq(executionView.operationId, operationId), eq(executionView.kind, 'route'), gte(executionView.date, from), lte(executionView.date, to)));
  const bonus = await adjustmentsByExecution(tx, executions.map((e) => e.id));
  const dayMap = new Map<string, HovershipDay>();
  const dayOf = (driverId: string, date: string) => {
    const key = `${driverId}|${date}`;
    const d = dayMap.get(key) ?? { date, driverId, t13: 0, t4: 0, stat: 0, bonusCents: 0, counts: {} };
    dayMap.set(key, d);
    return d;
  };
  // A day with a bonus and no pieces still counts (the bonus is paid).
  for (const e of executions) if (e.payeeDriverId && bonus.get(e.id)) dayOf(e.payeeDriverId, e.date).bonusCents = bonus.get(e.id)!;
  for (const w of records) {
    if (!w.driverId) continue;
    const d = dayOf(w.driverId, w.date);
    const item = w.serviceTypeId === ids.stat ? 'stat' : w.tierCode ?? 'T1-3';
    d.counts![item] = (d.counts![item] ?? 0) + w.pieces;
    if (item === 'stat') d.stat += w.pieces;
    else if (item === 'T4') d.t4 += w.pieces;
    else d.t13 += w.pieces;
  }
  return { records, days: [...dayMap.values()], stemCents: await otherRevenueTotal(tx, operationId, from, to) };
}

/** Everything the Hovership weekly screen needs for the week starting Monday `start`. */
export async function loadHovershipWeek(tx: Tx, actor: Actor, start: string) {
  assertCan(actor, 'payroll.view');
  const showMoney = can(actor.role, 'money.view');
  const op = await getOperation(tx, 'hovership');
  const end = addDays(start, 6);
  const { fn: rate, rows: rateRows, ids } = await hovershipRateFn(tx, op.id);

  const { days: hsDays, stemCents } = await loadHovershipDays(tx, op.id, ids, start, end);
  const summary = hovershipSummary(hsDays, stemCents, rate);

  const driverRows = summary.drivers.length
    ? (await driverProfiles(tx, end, summary.drivers.map((d) => d.driverId))).map((d) => ({ id: d.id, name: d.fullName, code: d.hovershipCode }))
    : [];
  const names = new Map(driverRows.map((d) => [d.id, d]));

  const imports = await tx.select().from(reportImports).where(and(eq(reportImports.operationId, op.id), lte(reportImports.periodStart, end), gte(reportImports.periodEnd, start))).orderBy(desc(reportImports.createdAt));
  const [lastImport] = await tx.select().from(reportImports).where(and(eq(reportImports.operationId, op.id), inArray(reportImports.status, ['done', 'partial']))).orderBy(desc(reportImports.receivedAt)).limit(1);
  const openCodes = await tx.select().from(exceptions).where(and(eq(exceptions.operationId, op.id), eq(exceptions.type, 'unknown_driver_code'), eq(exceptions.status, 'open'), lte(exceptions.date, end))).orderBy(asc(exceptions.date));
  const weekCodes = openCodes.filter((e) => (e.details as UnknownDetails).rows.some((r) => r.date >= start && r.date <= end));

  const period = periodFor(op.cycleAnchor, op.payCycle, start);
  const locked = (await lockedPeriodStarts(tx, op.id, period.start, period.end)).has(period.start);
  // Money fields become null for roles without money.view (rule 9: enforced here, not in the UI).
  const hide = <T extends object, K extends keyof T>(o: T, keys: K[]): Omit<T, K> & { [P in K]: T[P] | null } =>
    (showMoney ? o : { ...o, ...Object.fromEntries(keys.map((k) => [k, null])) }) as Omit<T, K> & { [P in K]: T[P] | null };

  const current = (item: 't1_3' | 't4' | 'stat') => {
    const r = rate(item, '', end);
    return { item, clientCents: showMoney && r.ok ? r.clientCents : null, driverCents: r.ok ? r.driverCents : null, missing: !r.ok };
  };

  return {
    week: { start, end }, period, locked, showMoney,
    canEditBonus: can(actor.role, 'hovership.enter_bonus') && !locked,
    canImport: can(actor.role, 'reports.import'),
    canResolve: can(actor.role, 'exceptions.clear'),
    importState: imports[0] ? { id: imports[0].id, status: imports[0].status, fileName: imports[0].fileName, rowCount: imports[0].rowCount, receivedAt: imports[0].receivedAt?.toISOString() ?? null, channel: imports[0].channel, problems: (imports[0].problems ?? {}) as ImportProblems } : null,
    lastImportAt: lastImport?.receivedAt?.toISOString() ?? null,
    totals: hide(summary.totals, ['revenueCents', 'stemCents', 'operationProfitCents', 'marginSumCents']),
    drivers: summary.drivers.map((d) => ({
      ...hide(d, ['revenueCents', 'marginCents']), name: names.get(d.driverId)?.name ?? '', code: names.get(d.driverId)?.code ?? '',
      days: summary.days.filter((v) => v.driverId === d.driverId).sort((a, b) => a.date.localeCompare(b.date)).map((v) => hide(v, ['revenueCents', 'marginCents'])),
    })).sort((a, b) => a.name.localeCompare(b.name)),
    lostMoney: showMoney ? summary.lostMoney.map((v) => ({ ...v, name: names.get(v.driverId)?.name ?? '' })) : [],
    missingRates: summary.missingRates.length,
    rates: [current('t1_3'), current('t4'), current('stat')],
    hasRates: rateRows.length > 0,
    // STEM is Aarisa's revenue, so only money roles see and classify it.
    canClassifyStem: showMoney && can(actor.role, 'reports.import'),
    stemToReview: showMoney ? await revenueToReview(tx, op.id, start, end) : [],
    zones: showMoney && can(actor.role, 'reports.import') ? await zoneOptions(tx) : [],
    unknownCodes: weekCodes.map((e) => {
      const d = e.details as UnknownDetails;
      return { exceptionId: e.id, code: d.code, name: d.name, days: d.rows.length, packages: d.rows.reduce((s, r) => s + r.t1 + r.t2 + r.t3 + r.t4, 0) };
    }),
  };
}

/** Week to open by default: the latest week with Hovership data, else the current week. */
export async function latestHovershipWeek(tx: Tx, today: string) {
  const op = await getOperation(tx, 'hovership');
  const [row] = await tx.select({ date: sql<string>`max(${workView.date})` }).from(workView).where(eq(workView.operationId, op.id));
  return weekStart(row?.date ?? today);
}

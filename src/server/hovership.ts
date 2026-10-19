import { and, asc, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import type { Tx } from '~/db/client';
import { executionView, exceptions, reportImports, workView } from '~/db/schema';
import { addDays, weekStart } from '~/domain/dates';
import { hovershipSummary, type HovershipDay, type RateFn } from '~/domain/hovership';
import { can } from '~/domain/permissions';
import { periodFor } from '~/domain/periods';
import { rateFor } from '~/domain/rates';
import { assertCan, type Actor } from './actor';
import { RuleError } from './errors';
import { adjustmentsByExecution, setManualBonus } from './adjustments';
import { payeeIdsByKey } from './executions';
import { importReport, type ImportProblems, type UnknownDetails } from './imports';
import { assertNotLocked, lockedPeriodStarts, operationFor } from './ops';
import { driverProfiles } from './people';
import { otherRevenueTotal, revenueToReview, zoneOptions } from './revenue';
import { valuationContext, type ValuationContext } from './valuation';

// The weekly report screen (spec 6.5) for clients whose report names the driver (Hovership today).
// A driver-day's pieces are kept per service and tier; the screen shows them as Tier 1–3, Tier 4 and
// Stat when the client has those, and values them with the rate valid on each day.

/** Imports a report that names the driver (Hovership) through the generic reader. */
export async function importHovership(tx: Tx, actor: Actor, input: { fileName: string; text: string; columnOverride?: Record<string, string>; channel?: 'upload' | 'email'; operation?: string }) {
  return importReport(tx, actor, { ...input, operation: input.operation ?? (await operationFor(tx, undefined, 'report_code')).code });
}

export { resolveUnknownCode, type CodeResolution } from './imports';

/** Item key of a piece: its service and tier. */
const itemKey = (serviceTypeId: string, tierId: string | null) => `${serviceTypeId}|${tierId ?? ''}`;

/** Rates of an item on a date for a driver (the driver's special rate first). */
async function rateFnFor(tx: Tx, ctx: ValuationContext): Promise<RateFn> {
  const payeeOf = await payeeIdsByKey(tx);
  return (item, driverId, date) => {
    const [service, tier] = item.split('|');
    return rateFor(ctx.rows, service!, tier || null, payeeOf.get(`d:${driverId}`) ?? null, date);
  };
}

/** Bonus is typed per driver per day; it sits on that day's Tier 1–3 record. */
export async function setBonus(tx: Tx, actor: Actor, input: { driverId: string; date: string; bonusCents: number; operation?: string }) {
  assertCan(actor, 'hovership.enter_bonus');
  const op = await operationFor(tx, input.operation, 'report_code');
  await assertNotLocked(tx, op, input.date);
  if (input.bonusCents < 0) throw new RuleError('invalid_amount');
  // The bonus belongs to the driver's execution of that day (docs/db-model.md: pay_adjustments).
  const [day] = await tx.select().from(executionView).where(and(
    eq(executionView.operationId, op.id), eq(executionView.payeeDriverId, input.driverId), eq(executionView.date, input.date), eq(executionView.kind, 'route')));
  if (!day) throw new RuleError('not_found');
  const { before, after } = await setManualBonus(tx, actor, { executionId: day.id, payeeId: day.payeeId!, amountCents: input.bonusCents });
  return { id: (after ?? before)?.id ?? day.id, bonusCents: after?.amountCents ?? 0 };
}

/** Driver-days and other revenue for a date range, rebuilt from the work records and adjustments. */
export async function loadHovershipDays(tx: Tx, operationId: string, ctx: ValuationContext, from: string, to: string) {
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
    const key = itemKey(w.serviceTypeId, w.tierId);
    d.counts![key] = (d.counts![key] ?? 0) + w.pieces;
    if (ctx.services.get(w.serviceTypeId)?.unit === 'stop') d.stat += w.pieces;
    else if (w.tierCode === 'T4') d.t4 += w.pieces;
    else d.t13 += w.pieces;
  }
  return { records, days: [...dayMap.values()], stemCents: await otherRevenueTotal(tx, operationId, from, to) };
}

/** Everything the Hovership weekly screen needs for the week starting Monday `start`. */
export async function loadHovershipWeek(tx: Tx, actor: Actor, start: string, operation?: string) {
  assertCan(actor, 'payroll.view');
  const showMoney = can(actor.role, 'money.view');
  const op = await operationFor(tx, operation, 'report_code');
  const end = addDays(start, 6);
  const ctx = await valuationContext(tx, op.id);
  const rate = await rateFnFor(tx, ctx);

  const { days: hsDays, stemCents } = await loadHovershipDays(tx, op.id, ctx, start, end);
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

  // Rates in force at the end of the week, one line per service and tier of the report (retired tiers left out).
  const reportServices = [...ctx.services.values()].filter((x) => x.fromReport);
  const current = reportServices.flatMap((x) => {
    const tiers = [...ctx.tiers.values()].filter((t) => t.serviceTypeId === x.id && t.active).sort((a, b) => a.sortOrder - b.sortOrder);
    return (tiers.length ? tiers : [null]).map((t) => {
      const r = rate(itemKey(x.id, t?.id ?? null), '', end);
      return { item: itemKey(x.id, t?.id ?? null), service: x.name, serviceEs: x.nameEs, tier: t?.name ?? null, clientCents: showMoney && r.ok ? r.clientCents : null, driverCents: r.ok ? r.driverCents : null, missing: !r.ok };
    });
  });

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
    rates: current,
    hasRates: ctx.rows.length > 0,
    operation: { code: op.code, name: op.name },
    // Columns this client's report has, so another client's screen doesn't show Tier 4 or Stat it never sends.
    shows: { tier4: [...ctx.tiers.values()].some((t) => t.code === 'T4'), stops: [...ctx.services.values()].some((x) => x.fromReport && x.unit === 'stop'), tiers: ctx.tiers.size > 0 },
    // STEM is Aarisa's revenue, so only money roles see and classify it.
    canClassifyStem: showMoney && can(actor.role, 'reports.import'),
    stemToReview: showMoney ? await revenueToReview(tx, op.id, start, end) : [],
    zones: showMoney && can(actor.role, 'reports.import') ? await zoneOptions(tx) : [],
    unknownCodes: weekCodes.map((e) => {
      const d = e.details as UnknownDetails;
      const legacy = (r: unknown) => r as { t1?: number; t2?: number; t3?: number; t4?: number; quantities?: Record<string, number> };
      const packages = d.rows.reduce((s, r) => s + (legacy(r).quantities ? Object.values(legacy(r).quantities!).reduce((a, n) => a + n, 0) : (legacy(r).t1 ?? 0) + (legacy(r).t2 ?? 0) + (legacy(r).t3 ?? 0) + (legacy(r).t4 ?? 0)), 0);
      return { exceptionId: e.id, code: d.code, name: d.name, days: d.rows.length, packages };
    }),
  };
}

/** Week to open by default: the latest week with Hovership data, else the current week. */
export async function latestHovershipWeek(tx: Tx, today: string, operation?: string) {
  const op = await operationFor(tx, operation, 'report_code');
  const [row] = await tx.select({ date: sql<string>`max(${workView.date})` }).from(workView).where(eq(workView.operationId, op.id));
  return weekStart(row?.date ?? today);
}

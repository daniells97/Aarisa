import { and, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import type { Tx } from '~/db/client';
import { drivers, exceptions, payPeriods, payrollLines, payrollRuns, users, workRecords } from '~/db/schema';
import { addDays } from '~/domain/dates';
import { valueDay } from '~/domain/hovership';
import { can } from '~/domain/permissions';
import { buildPayroll, payrollCsv, type Blocker, type PayrollTotals } from '~/domain/payroll';
import { periodFor, periodsFor } from '~/domain/periods';
import { assertCan, type Actor } from './actor';
import { audit, type AuditEntry } from './audit';
import { RuleError } from './errors';
import { loadHovershipDays } from './hovership';
import { getOperation, hovershipRateFn } from './ops';

// Payroll runs (spec §5.5, rule 3). A run is identified as `<operation>-<period start>`;
// rows in payroll_runs exist once a run has been approved.

export const REOPEN_HOURS = 24;
export type RunStatus = 'draft' | 'ready' | 'approved' | 'reopened' | 'paid';

export function parseRunId(runId: string) {
  const m = /^(hovership|tforce)-(\d{4}-\d{2}-\d{2})$/.exec(runId);
  if (!m) throw new RuleError('not_found');
  return { operation: m[1] as 'hovership' | 'tforce', start: m[2]! };
}

async function storedRun(tx: Tx, operationId: string, start: string) {
  const [row] = await tx.select({ period: payPeriods, run: payrollRuns }).from(payPeriods)
    .leftJoin(payrollRuns, eq(payrollRuns.payPeriodId, payPeriods.id))
    .where(and(eq(payPeriods.operationId, operationId), eq(payPeriods.startDate, start)));
  return row;
}

/** Live calculation of a Hovership run from the current work records and rates. */
async function computeHovership(tx: Tx, op: Awaited<ReturnType<typeof getOperation>>, start: string) {
  const period = periodFor(op.cycleAnchor, op.payCycle, start);
  if (period.start !== start) throw new RuleError('not_found');
  const { fn: rate, ids } = await hovershipRateFn(tx, op.id);
  const { days, stemCents, records } = await loadHovershipDays(tx, op.id, ids, period.start, period.end);
  const valued = days.map((d) => valueDay(d, rate));

  const weeks = [period.start, ...(op.payCycle === 'biweekly' ? [addDays(period.start, 7)] : [])];
  const covered = weeks.filter((w) => records.some((r) => r.date >= w && r.date <= addDays(w, 6)));
  const [open] = await tx.select({ n: sql<number>`count(*)::int` }).from(exceptions)
    .where(and(eq(exceptions.operationId, op.id), eq(exceptions.status, 'open'), gte(exceptions.date, period.start), lte(exceptions.date, period.end)));

  // Previous approved run, to spot drivers who are new this time.
  const [prev] = await tx.select({ runId: payrollRuns.id }).from(payrollRuns).innerJoin(payPeriods, eq(payrollRuns.payPeriodId, payPeriods.id))
    .where(and(eq(payPeriods.operationId, op.id), sql`${payPeriods.startDate} < ${period.start}`, inArray(payrollRuns.status, ['approved', 'paid'])))
    .orderBy(desc(payPeriods.startDate)).limit(1);
  const previousDriverIds = prev ? (await tx.select({ id: payrollLines.driverId }).from(payrollLines).where(eq(payrollLines.runId, prev.runId))).map((l) => l.id!).filter(Boolean) : null;

  const result = buildPayroll({ days: valued, otherRevenueCents: stemCents, expectedWeeks: weeks, coveredWeeks: covered, openExceptions: open?.n ?? 0, previousDriverIds });
  return { period, records, valued, weeks, covered, ...result };
}

async function driverInfo(tx: Tx, ids: string[]) {
  if (!ids.length) return new Map<string, { name: string; code: string }>();
  const rows = await tx.select({ id: drivers.id, name: drivers.fullName, code: drivers.hovershipCode }).from(drivers).where(inArray(drivers.id, ids));
  return new Map(rows.map((d) => [d.id, { name: d.name, code: d.code ?? '' }]));
}

export interface RunLineView { driverId: string; name: string; code: string; routeDays: number; packages: number; stops: number; bonusCents: number; payCents: number; marginCents: number | null }

export async function loadRun(tx: Tx, actor: Actor, runId: string, now = new Date()) {
  assertCan(actor, 'payroll.view');
  const showMoney = can(actor.role, 'money.view');
  const { operation, start } = parseRunId(runId);
  if (operation !== 'hovership') throw new RuleError('not_found'); // T-Force runs arrive in Phase 2
  const op = await getOperation(tx, operation);
  const live = await computeHovership(tx, op, start);
  const stored = await storedRun(tx, op.id, start);
  const run = stored?.run ?? null;
  const frozen = run && (run.status === 'approved' || run.status === 'paid');

  let lines: RunLineView[];
  let totals: PayrollTotals;
  if (frozen) {
    const rows = await tx.select().from(payrollLines).where(eq(payrollLines.runId, run.id));
    const info = await driverInfo(tx, rows.map((r) => r.driverId!).filter(Boolean));
    lines = rows.map((r) => ({ driverId: r.driverId!, name: info.get(r.driverId!)?.name ?? '', code: info.get(r.driverId!)?.code ?? '', routeDays: r.routeDays, packages: r.pieces, stops: r.stops, bonusCents: r.bonusCents, payCents: r.payCents, marginCents: r.marginCents }));
    totals = run.totals as PayrollTotals;
  } else {
    const info = await driverInfo(tx, live.lines.map((l) => l.driverId));
    lines = live.lines.map((l) => ({ ...l, name: info.get(l.driverId)?.name ?? '', code: info.get(l.driverId)?.code ?? '' }));
    totals = live.totals;
  }
  lines.sort((a, b) => a.name.localeCompare(b.name));
  const status: RunStatus = run?.status === 'approved' || run?.status === 'paid' || run?.status === 'reopened' ? run.status : live.ready ? 'ready' : 'draft';
  const reopenableUntil = run?.reopenableUntil?.toISOString() ?? null;
  const approver = run?.approvedBy ? (await tx.select({ name: users.name }).from(users).where(eq(users.id, run.approvedBy)))[0]?.name ?? null : null;
  const info = await driverInfo(tx, [...live.warnings.newDrivers, ...live.warnings.negativeDays.map((d) => d.driverId)]);

  return {
    runId, operation, period: live.period, status, showMoney,
    approvedAt: run?.approvedAt?.toISOString() ?? null, approvedBy: approver, paidAt: run?.paidAt?.toISOString() ?? null,
    reopenableUntil,
    canApprove: can(actor.role, 'payroll.approve') && (status === 'ready' || (status === 'reopened' && live.ready)),
    canReopen: can(actor.role, 'payroll.reopen') && status === 'approved' && !!run?.reopenableUntil && run.reopenableUntil > now,
    canMarkPaid: can(actor.role, 'payroll.approve') && status === 'approved',
    canExport: can(actor.role, 'payroll.export'),
    blockers: frozen ? [] : live.blockers,
    weeks: live.weeks.map((w) => ({ start: w, read: live.covered.includes(w) })),
    totals: showMoney ? totals : { ...totals, revenueCents: null, otherRevenueCents: null, profitCents: null },
    lines: lines.map((l) => (showMoney ? l : { ...l, marginCents: null })),
    // Changes since approval don't alter a frozen run; tell the owner if live numbers moved.
    liveDiffersCents: frozen ? live.totals.payCents - totals.payCents : 0,
    warnings: {
      newDrivers: live.warnings.newDrivers.map((id) => info.get(id)?.name ?? ''),
      negativeDays: showMoney ? live.warnings.negativeDays.slice(0, 5).map((d) => ({ name: info.get(d.driverId)?.name ?? '', date: d.date, marginCents: d.marginCents })) : [],
      negativeDayCount: showMoney ? live.warnings.negativeDays.length : 0,
    },
  };
}

/** All Hovership pay periods that have work, newest first, plus their status. */
export async function listRuns(tx: Tx, actor: Actor, now = new Date()) {
  assertCan(actor, 'payroll.view');
  const op = await getOperation(tx, 'hovership');
  const dates = await tx.selectDistinct({ date: workRecords.date }).from(workRecords).where(eq(workRecords.operationId, op.id));
  const periods = periodsFor(op.cycleAnchor, op.payCycle, dates.map((d) => d.date)).reverse();
  const runs = [];
  for (const p of periods) {
    const r = await loadRun(tx, actor, `hovership-${p.start}`, now);
    runs.push({ runId: r.runId, operation: r.operation, period: r.period, status: r.status, payCents: r.totals.payCents, blockers: r.blockers, paidAt: r.paidAt, approvedAt: r.approvedAt });
  }
  return { runs, payCycles: { hovership: op.payCycle } };
}

/** Rule 3 + §6.8: approve with the exact amount the owner saw; snapshot rates and lock the period. */
export async function approveRun(tx: Tx, actor: Actor, runId: string, expectedPayCents: number, now = new Date()) {
  assertCan(actor, 'payroll.approve');
  const { operation, start } = parseRunId(runId);
  if (operation !== 'hovership') throw new RuleError('not_found');
  const op = await getOperation(tx, operation);
  const live = await computeHovership(tx, op, start);
  const stored = await storedRun(tx, op.id, start);
  if (stored?.run && (stored.run.status === 'approved' || stored.run.status === 'paid')) throw new RuleError('already_approved');
  if (!live.ready) throw new RuleError('run_not_ready');
  if (live.totals.payCents !== expectedPayCents) throw new RuleError('total_changed');

  const trail: AuditEntry[] = [];
  const log = (table: string, recordId: string, action: AuditEntry['action'], before: unknown, after: unknown) =>
    trail.push({ table, recordId, action, before, after, userId: actor.userId, source: actor.source });

  let periodRow = stored?.period;
  if (!periodRow) {
    [periodRow] = await tx.insert(payPeriods).values({ operationId: op.id, startDate: live.period.start, endDate: live.period.end }).returning();
    log('pay_periods', periodRow!.id, 'insert', null, periodRow);
  }
  const runValues = {
    status: 'approved' as const, totals: live.totals, approvedBy: actor.userId, approvedAt: now,
    reopenableUntil: new Date(now.getTime() + REOPEN_HOURS * 3_600_000), paidAt: null,
  };
  let run;
  if (stored?.run) {
    [run] = await tx.update(payrollRuns).set(runValues).where(eq(payrollRuns.id, stored.run.id)).returning();
    const removed = await tx.delete(payrollLines).where(eq(payrollLines.runId, stored.run.id)).returning();
    for (const l of removed) log('payroll_lines', l.id, 'delete', l, null);
  } else {
    [run] = await tx.insert(payrollRuns).values({ payPeriodId: periodRow!.id, ...runValues }).returning();
  }
  const inserted = await tx.insert(payrollLines).values(live.lines.map((l) => ({
    runId: run!.id, driverId: l.driverId, routeDays: l.routeDays, pieces: l.packages, stops: l.stops, bonusCents: l.bonusCents, payCents: l.payCents, marginCents: l.marginCents,
  }))).returning();
  for (const l of inserted) log('payroll_lines', l.id, 'insert', null, l);

  // Snapshot the rate and money on every work record (spec §4: values copied when the period is approved).
  const { fn: rate, ids } = await hovershipRateFn(tx, op.id);
  for (const w of live.records) {
    if (!w.driverId) continue;
    const item = w.serviceTypeId === ids.stat ? 'stat' : w.tier === 't4' ? 't4' : 't1_3';
    const r = rate(item, w.driverId, w.date);
    if (!r.ok) throw new RuleError('run_not_ready');
    const driverPay = w.pieces * (r.driverCents ?? 0) + w.bonusCents;
    const revenue = w.pieces * (r.clientCents ?? 0);
    const [after] = await tx.update(workRecords).set({
      clientRateCents: r.clientCents, driverRateCents: r.driverCents, driverPayCents: driverPay, revenueCents: revenue,
      profitCents: revenue - driverPay, payrollRunId: run!.id, updatedAt: now,
    }).where(eq(workRecords.id, w.id)).returning();
    log('work_records', w.id, 'update', w, after);
  }
  await audit(tx, trail);
  await audit(tx, { table: 'payroll_runs', recordId: run!.id, action: 'approve', before: stored?.run ?? null, after: run, userId: actor.userId, source: actor.source });
  return run!;
}

/** Owner only, within 24 hours of approval; written to the audit log (rule 3). */
export async function reopenRun(tx: Tx, actor: Actor, runId: string, now = new Date()) {
  assertCan(actor, 'payroll.reopen');
  const { operation, start } = parseRunId(runId);
  const op = await getOperation(tx, operation);
  const stored = await storedRun(tx, op.id, start);
  const run = stored?.run;
  if (!run || run.status !== 'approved') throw new RuleError('not_approved');
  if (!run.reopenableUntil || run.reopenableUntil <= now) throw new RuleError('reopen_expired');
  const [after] = await tx.update(payrollRuns).set({ status: 'reopened' }).where(eq(payrollRuns.id, run.id)).returning();
  await audit(tx, { table: 'payroll_runs', recordId: run.id, action: 'reopen', before: run, after, userId: actor.userId, source: actor.source });
  return after!;
}

export async function markRunPaid(tx: Tx, actor: Actor, runId: string, now = new Date()) {
  assertCan(actor, 'payroll.approve');
  const { operation, start } = parseRunId(runId);
  const op = await getOperation(tx, operation);
  const run = (await storedRun(tx, op.id, start))?.run;
  if (!run || run.status !== 'approved') throw new RuleError('not_approved');
  const [after] = await tx.update(payrollRuns).set({ status: 'paid', paidAt: now }).where(eq(payrollRuns.id, run.id)).returning();
  await audit(tx, { table: 'payroll_runs', recordId: run.id, action: 'update', before: run, after, userId: actor.userId, source: actor.source });
  return after!;
}

export async function exportRun(tx: Tx, actor: Actor, runId: string) {
  assertCan(actor, 'payroll.export');
  const view = await loadRun(tx, { ...actor, role: actor.role }, runId);
  const csv = payrollCsv({ operation: view.operation, start: view.period.start, end: view.period.end },
    view.lines.map((l) => ({ name: l.name, code: l.code, payee: 'driver', routeDays: l.routeDays, packages: l.packages, stops: l.stops, bonusCents: l.bonusCents, payCents: l.payCents })));
  const approved = view.status === 'approved' || view.status === 'paid';
  return { csv, fileName: `aarisa-${view.operation}-payroll-${view.period.start}${approved ? '' : '-draft'}.csv` };
}

export type { Blocker };

import { and, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import type { Tx } from '~/db/client';
import { executionView, exceptions, payPeriods, payrollLines, payrollRuns, users, workRecords, workView } from '~/db/schema';
import { addDays, todayLA } from '~/domain/dates';
import { can } from '~/domain/permissions';
import { buildRun, payeeKey, payrollCsv, type Blocker, type PayrollTotals, type RunItem } from '~/domain/payroll';
import { rateFor } from '~/domain/rates';
import { periodFor, periodsFor } from '~/domain/periods';
import { assertCan, type Actor } from './actor';
import { audit, type AuditEntry } from './audit';
import { RuleError } from './errors';
import { adjustmentsByExecution } from './adjustments';
import { getOperation, listOperations, type Operation } from './ops';
import { otherRevenueTotal } from './revenue';
import { counts, valuationContext } from './valuation';
import { lateCorrections } from './claims';
import { payeeIdsByKey, payeeRefs } from './executions';
import { contractorProfiles, driverProfiles } from './people';

// Payroll runs (spec §5.5, rule 3). A run is identified as `<operation>-<period start>`;
// rows in payroll_runs exist once a run has been approved.

export const REOPEN_HOURS = 24;
export type RunStatus = 'draft' | 'ready' | 'approved' | 'reopened' | 'paid';

export function parseRunId(runId: string) {
  const m = /^([a-z0-9_]+)-(\d{4}-\d{2}-\d{2})$/.exec(runId);
  if (!m) throw new RuleError('not_found');
  return { operation: m[1]!, start: m[2]! };
}

async function storedRun(tx: Tx, operationId: string, start: string) {
  const [row] = await tx.select({ period: payPeriods, run: payrollRuns }).from(payPeriods)
    .leftJoin(payrollRuns, eq(payrollRuns.payPeriodId, payPeriods.id))
    .where(and(eq(payPeriods.operationId, operationId), eq(payPeriods.startDate, start)));
  return row;
}

/** Values copied onto a work record when its run is approved (spec §4). */
interface Snapshot {
  record: typeof workView.$inferSelect;
  values: { clientRateCents: number | null; driverRateCents: number | null; driverPayCents: number; revenueCents: number };
}

/** Previous approved run's payees, to spot new drivers or contractors. */
async function previousPayees(tx: Tx, operationId: string, start: string) {
  const [prev] = await tx.select({ runId: payrollRuns.id }).from(payrollRuns).innerJoin(payPeriods, eq(payrollRuns.payPeriodId, payPeriods.id))
    .where(and(eq(payPeriods.operationId, operationId), sql`${payPeriods.startDate} < ${start}`, inArray(payrollRuns.status, ['approved', 'paid'])))
    .orderBy(desc(payPeriods.startDate)).limit(1);
  if (!prev) return null;
  const lines = await tx.select({ payeeId: payrollLines.payeeId }).from(payrollLines).where(eq(payrollLines.runId, prev.runId));
  const refs = await payeeRefs(tx);
  return lines.map((l) => payeeKey(refs.get(l.payeeId)!));
}

async function openExceptionCount(tx: Tx, operationId: string, from: string, to: string) {
  const [open] = await tx.select({ n: sql<number>`count(*)::int` }).from(exceptions)
    .where(and(eq(exceptions.operationId, operationId), eq(exceptions.status, 'open'), gte(exceptions.date, from), lte(exceptions.date, to)));
  return open?.n ?? 0;
}

/**
 * Live run for any contract and its own pay cycle (rule 8): one item per execution of a payee in the
 * period. Route executions pay pieces × the payee rate valid that day (a special rate first) plus their
 * pay adjustments (bonuses); extra executions pay each job at its agreed amount and are not route days.
 * Executions with no payee (not our route) are not paid. Other revenue (STEM) only enters profit.
 */
async function computeLive(tx: Tx, op: Operation, start: string) {
  const period = periodFor(op.cycleAnchor, op.payCycle, start);
  if (period.start !== start) throw new RuleError('not_found');
  const ctx = await valuationContext(tx, op.id);
  const executions = await tx.select().from(executionView).where(and(eq(executionView.operationId, op.id), gte(executionView.date, period.start), lte(executionView.date, period.end)));
  const records = await tx.select().from(workView).where(and(eq(workView.operationId, op.id), gte(workView.date, period.start), lte(workView.date, period.end)));
  const adjustments = await adjustmentsByExecution(tx, executions.map((e) => e.id));
  const workOf = new Map<string, (typeof records)[number][]>();
  for (const w of records) workOf.set(w.executionId, [...(workOf.get(w.executionId) ?? []), w]);

  const items: RunItem[] = [];
  const snapshots: Snapshot[] = [];
  for (const e of executions.sort((a, b) => a.date.localeCompare(b.date))) {
    if (!e.payeeId) continue;
    const payee = { driverId: e.payeeDriverId, contractorId: e.payeeContractorId };
    const work = workOf.get(e.id) ?? [];
    if (e.kind === 'extra') {
      // An extra job pays the amount agreed for it.
      for (const w of work) {
        const pay = w.pieces * (w.driverRateCents ?? 0), revenue = w.pieces * (w.clientRateCents ?? 0);
        items.push({ ...payee, date: e.date, packages: 0, stops: 0, bonusCents: 0, extraJob: true, payCents: pay, revenueCents: revenue, missingRate: false });
        snapshots.push({ record: w, values: { clientRateCents: w.clientRateCents, driverRateCents: w.driverRateCents, driverPayCents: pay, revenueCents: revenue } });
      }
      continue;
    }
    const bonus = adjustments.get(e.id) ?? 0;
    if (!work.length && !bonus) continue;
    let pay = 0, revenue = 0, missing = false;
    for (const w of work) {
      const r = rateFor(ctx.rows, w.serviceTypeId, w.tierId, e.payeeId, w.date);
      if (!r.ok) { missing = true; continue; }
      pay += w.pieces * r.driverCents;
      revenue += w.pieces * (r.clientCents ?? 0);
      snapshots.push({ record: w, values: { clientRateCents: r.clientCents, driverRateCents: r.driverCents, driverPayCents: w.pieces * r.driverCents, revenueCents: w.pieces * (r.clientCents ?? 0) } });
    }
    const c = counts(ctx, work.map((w) => ({ serviceTypeId: w.serviceTypeId, tierId: w.tierId, quantity: w.pieces })));
    items.push({ ...payee, date: e.date, packages: c.packages, stops: c.stops, bonusCents: bonus, payCents: pay + bonus, revenueCents: revenue, missingRate: missing });
  }

  // Corrections decided after their week was approved (an accepted claim) are paid in this period.
  const refs = await payeeRefs(tx);
  for (const a of await lateCorrections(tx, op.id, period.start)) {
    const payee = refs.get(a.payeeId);
    if (!payee) continue;
    items.push({ ...payee, date: period.start, packages: 0, stops: 0, bonusCents: 0, payCents: Number(a.amountCents), revenueCents: 0, missingRate: false, correction: true });
  }

  const weeks = op.payCycle === 'biweekly' ? [period.start, addDays(period.start, 7)] : [period.start];
  const covered = weeks.filter((w) => records.some((r) => r.source === 'client_report' && r.date >= w && r.date <= addDays(w, 6)));
  const result = buildRun({
    items, otherRevenueCents: await otherRevenueTotal(tx, op.id, period.start, period.end), expectedWeeks: weeks, coveredWeeks: covered,
    openExceptions: op.blocksPayrollOnExceptions ? await openExceptionCount(tx, op.id, period.start, period.end) : 0,
    previousPayees: await previousPayees(tx, op.id, period.start),
  });
  const snapshotsFn = (): Snapshot[] => {
    if (items.some((i) => i.missingRate)) throw new RuleError('run_not_ready');
    return snapshots;
  };
  return { period, weeks, covered, snapshots: snapshotsFn, ...result };
}

async function payeeInfo(tx: Tx, keys: string[]) {
  const driverIds = keys.filter((k) => k.startsWith('d:')).map((k) => k.slice(2));
  const contractorIds = keys.filter((k) => k.startsWith('c:')).map((k) => k.slice(2));
  const map = new Map<string, { name: string; code: string; contractor: boolean }>();
  if (driverIds.length) {
    for (const d of await driverProfiles(tx, todayLA(), driverIds)) {
      map.set(`d:${d.id}`, { name: d.fullName, code: d.hovershipCode ?? '', contractor: false });
    }
  }
  if (contractorIds.length) {
    for (const c of await contractorProfiles(tx, { ids: contractorIds })) {
      map.set(`c:${c.id}`, { name: c.name, code: '', contractor: true });
    }
  }
  return map;
}

export interface RunLineView { key: string; driverId: string | null; contractorId: string | null; contractor: boolean; name: string; code: string; routeDays: number; extraJobs: number; packages: number; stops: number; bonusCents: number; payCents: number; marginCents: number | null }

export async function loadRun(tx: Tx, actor: Actor, runId: string, now = new Date()) {
  assertCan(actor, 'payroll.view');
  const showMoney = can(actor.role, 'money.view');
  const { operation, start } = parseRunId(runId);
  const op = await getOperation(tx, operation);
  const live = await computeLive(tx, op, start);
  const stored = await storedRun(tx, op.id, start);
  const run = stored?.run ?? null;
  const frozen = run && (run.status === 'approved' || run.status === 'paid');

  let lines: RunLineView[];
  let totals: PayrollTotals;
  const view = (l: { driverId: string | null; contractorId: string | null; routeDays: number; extraJobs?: number; packages: number; stops: number; bonusCents: number; payCents: number; marginCents: number }, info: Awaited<ReturnType<typeof payeeInfo>>): RunLineView => {
    const key = payeeKey(l);
    const p = info.get(key);
    return { key, driverId: l.driverId, contractorId: l.contractorId, contractor: !!l.contractorId, name: p?.name ?? '', code: p?.code ?? '', routeDays: l.routeDays, extraJobs: l.extraJobs ?? 0, packages: l.packages, stops: l.stops, bonusCents: l.bonusCents, payCents: l.payCents, marginCents: l.marginCents };
  };
  if (frozen) {
    const refs = await payeeRefs(tx);
    const rows = (await tx.select().from(payrollLines).where(eq(payrollLines.runId, run.id))).map((r) => ({ ...r, ...refs.get(r.payeeId)!, packages: r.pieces }));
    const info = await payeeInfo(tx, rows.map(payeeKey));
    lines = rows.map((r) => view(r, info));
    totals = run.totals as PayrollTotals;
  } else {
    const info = await payeeInfo(tx, live.lines.map(payeeKey));
    lines = live.lines.map((l) => view(l, info));
    totals = live.totals;
  }
  lines.sort((a, b) => a.name.localeCompare(b.name));
  const status: RunStatus = run?.status === 'approved' || run?.status === 'paid' || run?.status === 'reopened' ? run.status : live.ready ? 'ready' : 'draft';
  const reopenableUntil = run?.reopenableUntil?.toISOString() ?? null;
  const approver = run?.approvedBy ? (await tx.select({ name: users.name }).from(users).where(eq(users.id, run.approvedBy)))[0]?.name ?? null : null;
  const info = await payeeInfo(tx, [...live.warnings.newPayees, ...live.warnings.negativeDays.map((d) => d.payee)]);

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
      newDrivers: live.warnings.newPayees.map((k) => info.get(k)?.name ?? ''),
      negativeDays: showMoney ? live.warnings.negativeDays.slice(0, 5).map((d) => ({ name: info.get(d.payee)?.name ?? '', date: d.date, marginCents: d.marginCents })) : [],
      negativeDayCount: showMoney ? live.warnings.negativeDays.length : 0,
    },
  };
}

/** Pay periods that have work, for both operations and their own pay cycles (rule 8), newest first. */
export async function listRuns(tx: Tx, actor: Actor, now = new Date()) {
  assertCan(actor, 'payroll.view');
  const runs = [];
  const payCycles: Record<string, string> = {};
  for (const op of await listOperations(tx)) {
    const code = op.code;
    payCycles[code] = op.payCycle;
    const dates = await tx.selectDistinct({ date: workView.date }).from(workView).where(eq(workView.operationId, op.id));
    for (const p of periodsFor(op.cycleAnchor, op.payCycle, dates.map((d) => d.date))) {
      const r = await loadRun(tx, actor, `${code}-${p.start}`, now);
      runs.push({ runId: r.runId, operation: r.operation, period: r.period, status: r.status, payCents: r.totals.payCents, blockers: r.blockers, paidAt: r.paidAt, approvedAt: r.approvedAt });
    }
  }
  runs.sort((a, b) => b.period.end.localeCompare(a.period.end) || a.operation.localeCompare(b.operation));
  return { runs, payCycles };
}

/** Rule 3 + §6.8: approve with the exact amount the owner saw; snapshot rates and lock the period. */
export async function approveRun(tx: Tx, actor: Actor, runId: string, expectedPayCents: number, now = new Date()) {
  assertCan(actor, 'payroll.approve');
  const { operation, start } = parseRunId(runId);
  const op = await getOperation(tx, operation);
  const live = await computeLive(tx, op, start);
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
  const payeeOf = await payeeIdsByKey(tx);
  const inserted = await tx.insert(payrollLines).values(live.lines.map((l) => ({
    runId: run!.id, payeeId: payeeOf.get(payeeKey(l))!, routeDays: l.routeDays, extraJobs: l.extraJobs, pieces: l.packages, stops: l.stops, bonusCents: l.bonusCents, payCents: l.payCents, marginCents: l.marginCents,
  }))).returning();
  for (const l of inserted) log('payroll_lines', l.id, 'insert', null, l);

  // Snapshot the rate and money on every work record (spec §4: values copied when the period is approved).
  for (const { record: w, values } of live.snapshots()) {
    const [after] = await tx.update(workRecords).set({ ...values, payrollRunId: run!.id, updatedAt: now }).where(eq(workRecords.id, w.id)).returning();
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
    view.lines.map((l) => ({ name: l.name, code: l.code, payee: l.contractor ? 'contractor' : 'driver', routeDays: l.routeDays, packages: l.packages, stops: l.stops, bonusCents: l.bonusCents, payCents: l.payCents })));
  const approved = view.status === 'approved' || view.status === 'paid';
  return { csv, fileName: `aarisa-${view.operation}-payroll-${view.period.start}${approved ? '' : '-draft'}.csv` };
}

export type { Blocker };

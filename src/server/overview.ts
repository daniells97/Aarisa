import type { Tx } from '~/db/client';
import { addDays } from '~/domain/dates';
import { can } from '~/domain/permissions';
import { assertCan, type Actor } from './actor';
import { latestHovershipWeek, loadHovershipWeek } from './hovership';
import { listRuns } from './payroll';
import { loadTforceWeek } from './tforce';
import { loadSettlements } from './settlements';

// Overview (spec 6.2) for both operations. Late payments join with Settlements in Phase 3.

export type NeedItem =
  | { kind: 'late_payment'; operation: string; lineKind: string; periodStart: string | null; periodEnd: string | null; reference: string | null; missingCents: number; daysLate: number; count: number; lineId: string }
  | { kind: 'tforce_exceptions'; count: number; week: string }
  | { kind: 'unknown_codes'; count: number; week: string }
  | { kind: 'run_ready'; runId: string; start: string; end: string; payCents: number }
  | { kind: 'run_blocked'; runId: string; start: string; end: string; reason: string }
  | { kind: 'missing_rates'; count: number; week: string }
  | { kind: 'lost_day'; name: string; date: string; packages: number; bonusCents: number; marginCents: number; count: number; week: string };

/** Mondays of the weeks that start in a month ("2026-11" → Nov 2, 9, 16, 23, 30). */
export function weeksStartingIn(month: string) {
  const first = `${month}-01`;
  const dow = new Date(`${first}T12:00:00Z`).getUTCDay();
  let monday = addDays(first, (8 - dow) % 7);
  const out: string[] = [];
  while (monday.startsWith(month)) { out.push(monday); monday = addDays(monday, 7); }
  return out;
}

const previousMonth = (month: string) => addDays(`${month}-01`, -1).slice(0, 7);

export type OverviewPeriod = { week?: string; month?: string };

/**
 * Overview for one week, or for a month as the weeks that start in it (each week is whole, so pay and
 * profit come from the same weekly figures; the range shown says which days that covers).
 */
export async function loadOverview(tx: Tx, actor: Actor, today: string, period: OverviewPeriod = {}) {
  assertCan(actor, 'payroll.view');
  const showMoney = can(actor.role, 'money.view');
  const latest = await latestHovershipWeek(tx, today);
  const month = period.month && weeksStartingIn(period.month).length ? period.month : null;
  const starts = month ? weeksStartingIn(month) : [period.week ?? latest];
  const runs = await listRuns(tx, actor);

  const weekOf = async (start: string) => {
    const cur = await loadHovershipWeek(tx, actor, start);
    const tf = await loadTforceWeek(tx, actor, start);
    const tfRun = runs.runs.find((r) => r.operation === 'tforce' && r.period.start === start);
    const tfPay = tfRun && !tfRun.blockers.some((b) => b.kind === 'missing_rates') ? tfRun.payCents : 0;
    return { start, cur, tf, tfRun, tfPay };
  };
  const weeks: Awaited<ReturnType<typeof weekOf>>[] = [];
  for (const st of starts) weeks.push(await weekOf(st));
  const prevStarts = month ? weeksStartingIn(previousMonth(month)) : [addDays(starts[0]!, -7)];
  let prevProfit: number | null = 0;
  for (const st of prevStarts) {
    const p = (await loadHovershipWeek(tx, actor, st)).totals.operationProfitCents;
    prevProfit = p == null || prevProfit == null ? null : prevProfit + p;
  }
  const sum = (f: (w: (typeof weeks)[number]) => number | null | undefined) => weeks.reduce((s, w) => s + (f(w) ?? 0), 0);
  const sumOrNull = (f: (w: (typeof weeks)[number]) => number | null | undefined) =>
    weeks.some((w) => f(w) == null) ? null : sum(f);
  // The week the "needs" are about: the one shown, or for a month the latest week in it.
  const focus = weeks[weeks.length - 1]!;
  const cur = focus.cur, tf = focus.tf, start = focus.start;

  // Most urgent first: things that block payroll, then money already lost.
  const needs: NeedItem[] = [];
  if (tf.summary.open) needs.push({ kind: 'tforce_exceptions', count: tf.summary.open, week: start });
  if (cur.unknownCodes.length) needs.push({ kind: 'unknown_codes', count: cur.unknownCodes.length, week: start });
  if (cur.missingRates) needs.push({ kind: 'missing_rates', count: cur.missingRates, week: start });
  const run = runs.runs.find((r) => r.operation === 'hovership' && r.period.start <= start && r.period.end >= start);
  if (run && (run.status === 'ready' || run.status === 'reopened') && can(actor.role, 'payroll.approve')) {
    needs.push({ kind: 'run_ready', runId: run.runId, start: run.period.start, end: run.period.end, payCents: run.payCents });
  } else if (run && run.status === 'draft' && run.blockers[0]) {
    const b = run.blockers[0];
    needs.push({ kind: 'run_blocked', runId: run.runId, start: run.period.start, end: run.period.end, reason: b.kind === 'missing_report' ? `missing_report:${b.weeks.join(',')}` : b.kind });
  }
  // Money already paid out and not collected comes right after payroll blockers (design 6.2).
  if (showMoney) {
    const late = (await loadSettlements(tx, actor, today)).lines.filter((l) => l.status === 'late' && (l.missingCents ?? 0) > 0).sort((a, b) => b.daysLate - a.daysLate);
    const top = late[0];
    if (top) needs.push({ kind: 'late_payment', operation: top.operation, lineKind: top.kind, periodStart: top.periodStart, periodEnd: top.periodEnd, reference: top.job?.orderNumber ?? top.reference, missingCents: top.missingCents!, daysLate: top.daysLate, count: late.length, lineId: top.id });
  }
  if (showMoney && cur.lostMoney[0]) {
    const d = cur.lostMoney[0];
    needs.push({ kind: 'lost_day', name: d.name, date: d.date, packages: d.t13 + d.t4, bonusCents: d.bonusCents, marginCents: d.marginCents, count: cur.lostMoney.length, week: start });
  }

  const perDay = weeks.flatMap((w) => Array.from({ length: 7 }, (_, i) => addDays(w.start, i)).map((date) => ({
    date,
    hovership: w.cur.drivers.flatMap((d) => d.days).filter((x) => x.date === date).reduce((s, x) => s + x.t13 + x.t4, 0),
    tforce: w.tf.days.includes(date) ? w.tf.dailyTotals[w.tf.days.indexOf(date)] ?? 0 : 0,
  })));
  const tfPay = sum((w) => w.tfPay);
  const hovPackages = sum((w) => (w.cur.totals.t13 ?? 0) + (w.cur.totals.t4 ?? 0));
  const profit = sumOrNull((w) => w.cur.totals.operationProfitCents);
  const change = (a: number | null, b: number | null) => (a == null || b == null || b === 0 ? null : Math.round(((a - b) / Math.abs(b)) * 100));

  return {
    week: { start: weeks[0]!.cur.week.start, end: weeks[weeks.length - 1]!.cur.week.end },
    month,
    weeks: starts.length,
    showMoney,
    needs,
    figures: {
      packages: hovPackages + sum((w) => w.tf.summary.pieces),
      hovershipPackages: hovPackages,
      tforcePieces: sum((w) => w.tf.summary.pieces),
      routeDays: sum((w) => (w.cur.totals.rows ?? 0) + w.tf.summary.routeDays),
      hovershipRouteDays: sum((w) => w.cur.totals.rows),
      tforceRouteDays: sum((w) => w.tf.summary.routeDays),
      owedCents: sum((w) => w.cur.totals.driverPayCents) + tfPay,
      profitCents: profit,
      profitChangePct: showMoney ? change(profit, prevProfit) : null,
    },
    perDay,
    hovership: {
      payCycle: runs.payCycles.hovership,
      revenueCents: showMoney ? sum((w) => (w.cur.totals.revenueCents ?? 0) + (w.cur.totals.stemCents ?? 0)) : null,
      driversCents: sum((w) => w.cur.totals.driverPayCents),
      profitCents: profit,
      hasData: weeks.some((w) => w.cur.drivers.length > 0),
    },
    tforce: {
      payCycle: runs.payCycles.tforce,
      pieces: sum((w) => w.tf.summary.pieces),
      routeDays: sum((w) => w.tf.summary.routeDays),
      open: sum((w) => w.tf.summary.open),
      payCents: tfPay || null,
      ratesMissing: weeks.some((w) => !!w.tfRun?.blockers.some((b) => b.kind === 'missing_rates')),
    },
  };
}

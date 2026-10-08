import type { Tx } from '~/db/client';
import { addDays } from '~/domain/dates';
import { can } from '~/domain/permissions';
import { assertCan, type Actor } from './actor';
import { latestHovershipWeek, loadHovershipWeek } from './hovership';
import { listRuns } from './payroll';
import { loadTforceWeek } from './tforce';

// Overview (spec 6.2) for both operations. Late payments join with Settlements in Phase 3.

export type NeedItem =
  | { kind: 'tforce_exceptions'; count: number; week: string }
  | { kind: 'unknown_codes'; count: number; week: string }
  | { kind: 'run_ready'; runId: string; start: string; end: string; payCents: number }
  | { kind: 'run_blocked'; runId: string; start: string; end: string; reason: string }
  | { kind: 'missing_rates'; count: number; week: string }
  | { kind: 'lost_day'; name: string; date: string; packages: number; bonusCents: number; marginCents: number; count: number; week: string };

export async function loadOverview(tx: Tx, actor: Actor, today: string, week?: string) {
  assertCan(actor, 'payroll.view');
  const showMoney = can(actor.role, 'money.view');
  const start = week ?? (await latestHovershipWeek(tx, today));
  const cur = await loadHovershipWeek(tx, actor, start);
  const prev = await loadHovershipWeek(tx, actor, addDays(start, -7));
  const tf = await loadTforceWeek(tx, actor, start);
  const runs = await listRuns(tx, actor);
  const tfRun = runs.runs.find((r) => r.operation === 'tforce' && r.period.start === start);

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
  if (showMoney && cur.lostMoney[0]) {
    const d = cur.lostMoney[0];
    needs.push({ kind: 'lost_day', name: d.name, date: d.date, packages: d.t13 + d.t4, bonusCents: d.bonusCents, marginCents: d.marginCents, count: cur.lostMoney.length, week: start });
  }

  const perDay = Array.from({ length: 7 }, (_, i) => addDays(start, i)).map((date) => ({
    date,
    hovership: cur.drivers.flatMap((d) => d.days).filter((x) => x.date === date).reduce((s, x) => s + x.t13 + x.t4, 0),
    tforce: tf.days.includes(date) ? tf.dailyTotals[tf.days.indexOf(date)] ?? 0 : 0,
  }));
  const tfPay = tfRun && !tfRun.blockers.some((b) => b.kind === 'missing_rates') ? tfRun.payCents : 0;
  const change = (a: number | null, b: number | null) => (a == null || b == null || b === 0 ? null : Math.round(((a - b) / Math.abs(b)) * 100));

  return {
    week: cur.week,
    showMoney,
    needs,
    figures: {
      packages: (cur.totals.t13 ?? 0) + (cur.totals.t4 ?? 0) + tf.summary.pieces,
      hovershipPackages: (cur.totals.t13 ?? 0) + (cur.totals.t4 ?? 0),
      tforcePieces: tf.summary.pieces,
      routeDays: (cur.totals.rows ?? 0) + tf.summary.routeDays,
      hovershipRouteDays: cur.totals.rows ?? 0,
      tforceRouteDays: tf.summary.routeDays,
      owedCents: (cur.totals.driverPayCents ?? 0) + tfPay,
      profitCents: cur.totals.operationProfitCents,
      profitChangePct: showMoney ? change(cur.totals.operationProfitCents, prev.totals.operationProfitCents) : null,
    },
    perDay,
    hovership: {
      payCycle: runs.payCycles.hovership,
      revenueCents: showMoney ? (cur.totals.revenueCents ?? 0) + (cur.totals.stemCents ?? 0) : null,
      driversCents: cur.totals.driverPayCents ?? 0,
      profitCents: cur.totals.operationProfitCents,
      hasData: cur.drivers.length > 0,
    },
    tforce: {
      payCycle: runs.payCycles.tforce,
      pieces: tf.summary.pieces,
      routeDays: tf.summary.routeDays,
      open: tf.summary.open,
      payCents: tfPay || null,
      ratesMissing: !!tfRun?.blockers.some((b) => b.kind === 'missing_rates'),
    },
  };
}

import type { Tx } from '~/db/client';
import { addDays } from '~/domain/dates';
import { can } from '~/domain/permissions';
import { assertCan, type Actor } from './actor';
import { latestHovershipWeek, loadHovershipWeek } from './hovership';
import { listRuns } from './payroll';

// Overview (spec 6.2), Phase 1: Hovership only. T-Force items join in Phase 2, late payments in Phase 3.

export type NeedItem =
  | { kind: 'unknown_codes'; count: number; week: string }
  | { kind: 'run_ready'; runId: string; start: string; end: string; payCents: number }
  | { kind: 'run_blocked'; runId: string; start: string; end: string; reason: string }
  | { kind: 'missing_rates'; count: number; week: string }
  | { kind: 'lost_day'; name: string; date: string; packages: number; bonusCents: number; marginCents: number; count: number; week: string };

export async function loadOverview(tx: Tx, actor: Actor, today: string, week?: string) {
  assertCan(actor, 'payroll.view');
  const showMoney = can(actor.role, 'money.view');
  const start = week ?? (await latestHovershipWeek(tx, today));
  const [cur, prev, runs] = await Promise.all([
    loadHovershipWeek(tx, actor, start),
    loadHovershipWeek(tx, actor, addDays(start, -7)),
    listRuns(tx, actor),
  ]);

  // Most urgent first: things that block payroll, then money already lost.
  const needs: NeedItem[] = [];
  if (cur.unknownCodes.length) needs.push({ kind: 'unknown_codes', count: cur.unknownCodes.length, week: start });
  if (cur.missingRates) needs.push({ kind: 'missing_rates', count: cur.missingRates, week: start });
  const run = runs.runs.find((r) => r.period.start <= start && r.period.end >= start);
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
  }));
  const change = (a: number | null, b: number | null) => (a == null || b == null || b === 0 ? null : Math.round(((a - b) / Math.abs(b)) * 100));

  return {
    week: cur.week,
    showMoney,
    needs,
    figures: {
      packages: (cur.totals.t13 ?? 0) + (cur.totals.t4 ?? 0),
      routeDays: cur.totals.rows ?? 0,
      owedCents: cur.totals.driverPayCents ?? 0,
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
  };
}

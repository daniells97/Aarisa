import type { ValuedDay } from './hovership';
import type { Cents } from './money';

// Payroll run for one operation and pay period (spec §5.5). Lines are per payee: a driver, or a
// contractor paid as one party (T-Force routes owned by Puma).

export interface Payee { driverId: string | null; contractorId: string | null }
export const payeeKey = (p: Payee) => (p.driverId ? `d:${p.driverId}` : `c:${p.contractorId}`);

/** One payable unit of work for a payee on a day (a Hovership driver-day or a T-Force route-day). */
export interface RunItem extends Payee {
  date: string;
  packages: number;
  stops: number;
  bonusCents: Cents;
  payCents: Cents;
  revenueCents: Cents;
  missingRate: boolean;
  /** An extra job pays an agreed amount but is not a route-day. */
  extraJob?: boolean;
}

export interface PayrollLine extends Payee {
  routeDays: number;
  extraJobs: number;
  packages: number;
  stops: number;
  bonusCents: Cents;
  payCents: Cents;
  revenueCents: Cents;
  marginCents: Cents;
}

export interface PayrollTotals {
  drivers: number; // payees: drivers plus contractors
  routeDays: number;
  extraJobs: number;
  packages: number;
  stops: number;
  bonusCents: Cents;
  payCents: Cents;
  revenueCents: Cents;
  otherRevenueCents: Cents; // STEM for Hovership
  profitCents: Cents; // revenue + other revenue − pay
}

export type Blocker =
  | { kind: 'missing_report'; weeks: string[] }
  | { kind: 'open_exceptions'; count: number }
  | { kind: 'missing_rates'; count: number }
  | { kind: 'no_work' };

export interface RunInput {
  items: RunItem[];
  otherRevenueCents: Cents;
  expectedWeeks: string[]; // Mondays of the period
  coveredWeeks: string[]; // Mondays that have a report
  openExceptions: number;
  previousPayees: string[] | null; // payee keys of the last approved run; null when there is none
}

export function buildRun(input: RunInput) {
  const byPayee = new Map<string, PayrollLine>();
  for (const it of input.items) {
    const k = payeeKey(it);
    const l = byPayee.get(k) ?? { driverId: it.driverId, contractorId: it.contractorId, routeDays: 0, extraJobs: 0, packages: 0, stops: 0, bonusCents: 0, payCents: 0, revenueCents: 0, marginCents: 0 };
    if (!it.extraJob) l.routeDays++;
    else l.extraJobs++;
    l.packages += it.packages;
    l.stops += it.stops;
    l.bonusCents += it.bonusCents;
    l.payCents += it.payCents;
    l.revenueCents += it.revenueCents;
    l.marginCents += it.revenueCents - it.payCents;
    byPayee.set(k, l);
  }
  const lines = [...byPayee.values()];
  const sum = (k: keyof PayrollLine) => lines.reduce((s, l) => s + (l[k] as number), 0);
  const totals: PayrollTotals = {
    drivers: lines.length,
    routeDays: sum('routeDays'),
    extraJobs: sum('extraJobs'),
    packages: sum('packages'),
    stops: sum('stops'),
    bonusCents: sum('bonusCents'),
    payCents: sum('payCents'),
    revenueCents: sum('revenueCents'),
    otherRevenueCents: input.otherRevenueCents,
    profitCents: sum('revenueCents') + input.otherRevenueCents - sum('payCents'),
  };

  const blockers: Blocker[] = [];
  const missingWeeks = input.expectedWeeks.filter((w) => !input.coveredWeeks.includes(w));
  if (missingWeeks.length) blockers.push({ kind: 'missing_report', weeks: missingWeeks });
  if (input.openExceptions > 0) blockers.push({ kind: 'open_exceptions', count: input.openExceptions });
  const missingRates = input.items.filter((i) => i.missingRate).length;
  if (missingRates) blockers.push({ kind: 'missing_rates', count: missingRates });
  if (!lines.length) blockers.push({ kind: 'no_work' });

  const newPayees = input.previousPayees ? lines.map(payeeKey).filter((k) => !input.previousPayees!.includes(k)) : [];
  const negativeDays = input.items.filter((i) => i.revenueCents - i.payCents < 0)
    .map((i) => ({ payee: payeeKey(i), date: i.date, marginCents: i.revenueCents - i.payCents }))
    .sort((a, b) => a.marginCents - b.marginCents);
  return { lines, totals, blockers, ready: blockers.length === 0, warnings: { newPayees, negativeDays } };
}

/** Hovership: one item per valued driver-day. */
export function hovershipItems(days: ValuedDay[]): RunItem[] {
  return days.map((d) => ({
    driverId: d.driverId, contractorId: null, date: d.date, packages: d.t13 + d.t4, stops: d.stat,
    bonusCents: d.bonusCents, payCents: d.driverPayCents, revenueCents: d.revenueCents, missingRate: d.missing.length > 0,
  }));
}

/** Kept for the Hovership tests: a run from valued driver-days. */
export function buildPayroll(input: Omit<RunInput, 'items' | 'previousPayees'> & { days: ValuedDay[]; previousDriverIds: string[] | null }) {
  const r = buildRun({ ...input, items: hovershipItems(input.days), previousPayees: input.previousDriverIds?.map((id) => `d:${id}`) ?? null });
  return { ...r, warnings: { newDrivers: r.warnings.newPayees.map((k) => k.slice(2)), negativeDays: r.warnings.negativeDays } };
}

const csvCell = (v: string | number) => {
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const dollars = (c: Cents) => (c / 100).toFixed(2);

export interface ExportLine { name: string; code: string; payee: string; routeDays: number; packages: number; stops: number; bonusCents: Cents; payCents: Cents }

/** Payroll file, CSV for now (open question 6: final format to confirm with Aarisa). */
export function payrollCsv(run: { operation: string; start: string; end: string }, lines: ExportLine[]) {
  const header = ['operation', 'period_start', 'period_end', 'payee', 'name', 'code', 'route_days', 'packages', 'stops', 'bonus', 'pay'];
  const rows = lines.map((l) => [run.operation, run.start, run.end, l.payee, l.name, l.code, l.routeDays, l.packages, l.stops, dollars(l.bonusCents), dollars(l.payCents)]);
  const total = lines.reduce((s, l) => s + l.payCents, 0);
  rows.push([run.operation, run.start, run.end, 'total', '', '', '', '', '', dollars(lines.reduce((s, l) => s + l.bonusCents, 0)), dollars(total)]);
  return [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

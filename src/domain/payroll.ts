import type { ValuedDay } from './hovership';
import type { Cents } from './money';

// Payroll run for one operation and pay period (spec §5.5).

export interface PayrollLine {
  driverId: string;
  routeDays: number;
  packages: number;
  stops: number;
  bonusCents: Cents;
  payCents: Cents;
  revenueCents: Cents;
  marginCents: Cents;
}

export interface PayrollTotals {
  drivers: number;
  routeDays: number;
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

export interface PayrollInput {
  days: ValuedDay[];
  otherRevenueCents: Cents;
  expectedWeeks: string[]; // Mondays of the period
  coveredWeeks: string[]; // Mondays that have a report
  openExceptions: number;
  previousDriverIds: string[] | null; // null when there is no earlier run
}

export function buildPayroll(input: PayrollInput) {
  const byDriver = new Map<string, PayrollLine>();
  for (const d of input.days) {
    const l = byDriver.get(d.driverId) ?? { driverId: d.driverId, routeDays: 0, packages: 0, stops: 0, bonusCents: 0, payCents: 0, revenueCents: 0, marginCents: 0 };
    l.routeDays++;
    l.packages += d.t13 + d.t4;
    l.stops += d.stat;
    l.bonusCents += d.bonusCents;
    l.payCents += d.driverPayCents;
    l.revenueCents += d.revenueCents;
    l.marginCents += d.marginCents;
    byDriver.set(d.driverId, l);
  }
  const lines = [...byDriver.values()];
  const sum = (k: keyof PayrollLine) => lines.reduce((s, l) => s + (l[k] as number), 0);
  const totals: PayrollTotals = {
    drivers: lines.length,
    routeDays: sum('routeDays'),
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
  const missingRates = input.days.filter((d) => d.missing.length > 0).length;
  if (missingRates) blockers.push({ kind: 'missing_rates', count: missingRates });
  if (!lines.length) blockers.push({ kind: 'no_work' });

  const newDrivers = input.previousDriverIds ? lines.map((l) => l.driverId).filter((id) => !input.previousDriverIds!.includes(id)) : [];
  const negativeDays = input.days.filter((d) => d.marginCents < 0).sort((a, b) => a.marginCents - b.marginCents);

  return { lines, totals, blockers, ready: blockers.length === 0, warnings: { newDrivers, negativeDays } };
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

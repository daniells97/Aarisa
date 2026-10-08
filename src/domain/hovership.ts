import type { Cents } from './money';
import type { RateLookup, Tier } from './rates';

// Hovership money rules (spec §5.2). STEM is never part of a driver's pay or margin;
// it is operation revenue and only enters the operation profit.

export type HovershipItem = 't1_3' | 't4' | 'stat';

export interface HovershipDay {
  date: string;
  driverId: string;
  t13: number;
  t4: number;
  stat: number;
  bonusCents: Cents;
}

/** Rate for an item on a date for a driver; `ok: false` means missing. */
export type RateFn = (item: HovershipItem, driverId: string, date: string) => RateLookup;

export interface ValuedDay extends HovershipDay {
  routePayCents: Cents; // pieces × driver rates, before bonus
  driverPayCents: Cents; // route pay + bonus
  revenueCents: Cents; // package and stat revenue
  marginCents: Cents; // revenue − driver pay
  missing: HovershipItem[];
}

export function valueDay(day: HovershipDay, rate: RateFn): ValuedDay {
  const items: [HovershipItem, number][] = [['t1_3', day.t13], ['t4', day.t4], ['stat', day.stat]];
  let routePay = 0, revenue = 0;
  const missing: HovershipItem[] = [];
  for (const [item, count] of items) {
    if (count === 0) continue;
    const r = rate(item, day.driverId, day.date);
    if (!r.ok) { missing.push(item); continue; }
    routePay += count * (r.driverCents ?? 0);
    revenue += count * (r.clientCents ?? 0);
  }
  const driverPay = routePay + day.bonusCents;
  return { ...day, routePayCents: routePay, driverPayCents: driverPay, revenueCents: revenue, marginCents: revenue - driverPay, missing };
}

export interface DriverTotals {
  driverId: string;
  days: number;
  t13: number; t4: number; stat: number;
  routePayCents: Cents; bonusCents: Cents; driverPayCents: Cents; revenueCents: Cents; marginCents: Cents;
}

export interface HovershipTotals {
  rows: number;
  drivers: number;
  t13: number; t4: number; stat: number;
  routePayCents: Cents;
  bonusCents: Cents;
  driverPayCents: Cents;
  revenueCents: Cents; // package and stat revenue
  stemCents: Cents;
  operationProfitCents: Cents; // revenue + STEM − driver pay
  marginSumCents: Cents; // sum of per-driver margins, STEM excluded
}

export function hovershipSummary(days: HovershipDay[], stemCents: Cents, rate: RateFn) {
  const valued = days.map((d) => valueDay(d, rate));
  const byDriver = new Map<string, DriverTotals>();
  for (const v of valued) {
    const t = byDriver.get(v.driverId) ?? { driverId: v.driverId, days: 0, t13: 0, t4: 0, stat: 0, routePayCents: 0, bonusCents: 0, driverPayCents: 0, revenueCents: 0, marginCents: 0 };
    t.days++; t.t13 += v.t13; t.t4 += v.t4; t.stat += v.stat;
    t.routePayCents += v.routePayCents; t.bonusCents += v.bonusCents; t.driverPayCents += v.driverPayCents;
    t.revenueCents += v.revenueCents; t.marginCents += v.marginCents;
    byDriver.set(v.driverId, t);
  }
  const sum = (k: keyof ValuedDay) => valued.reduce((s, v) => s + (v[k] as number), 0);
  const totals: HovershipTotals = {
    rows: valued.length,
    drivers: byDriver.size,
    t13: sum('t13'), t4: sum('t4'), stat: sum('stat'),
    routePayCents: sum('routePayCents'),
    bonusCents: sum('bonusCents'),
    driverPayCents: sum('driverPayCents'),
    revenueCents: sum('revenueCents'),
    stemCents,
    operationProfitCents: sum('revenueCents') + stemCents - sum('driverPayCents'),
    marginSumCents: sum('marginCents'),
  };
  return {
    totals,
    days: valued,
    drivers: [...byDriver.values()],
    lostMoney: valued.filter((v) => v.marginCents < 0).sort((a, b) => a.marginCents - b.marginCents),
    missingRates: valued.filter((v) => v.missing.length > 0),
  };
}

export const tierOf = (item: HovershipItem): Tier | null => (item === 'stat' ? null : item);

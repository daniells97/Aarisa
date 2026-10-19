import type { Cents } from './money';

/**
 * One rate row (docs/db-model.md §2.4). Each side has its own history: `client` is what the client pays
 * Aarisa, `payee` what Aarisa pays the driver or contractor. `payeeId` set = a special payee-side rate.
 */
export interface RateRow {
  id: string;
  serviceTypeId: string;
  tierId: string | null;
  payeeId: string | null;
  side: 'client' | 'payee';
  rateCents: Cents;
  effectiveFrom: string; // YYYY-MM-DD
}

export type RateLookup =
  | { ok: true; rateId: string; clientRateId: string | null; clientCents: Cents | null; driverCents: Cents; effectiveFrom: string }
  | { ok: false; reason: 'missing_rate' };

const latest = (rows: RateRow[]) => rows.reduce<RateRow | undefined>((best, r) => (!best || r.effectiveFrom > best.effectiveFrom ? r : best), undefined);

/**
 * The rates valid on `date` for a service and tier (spec §5.1). Rates are never edited, so the latest
 * `effectiveFrom` on or before the date wins, on each side independently. On the payee side a special
 * rate for that payee wins over the general one. Without a payee-side rate the work can't be paid
 * (missing rate); a missing client side only leaves revenue unknown.
 */
export function rateFor(rates: RateRow[], serviceTypeId: string, tierId: string | null, payeeId: string | null, date: string): RateLookup {
  const candidates = rates.filter((r) => r.serviceTypeId === serviceTypeId && r.tierId === tierId && r.effectiveFrom <= date);
  const payee = (payeeId ? latest(candidates.filter((r) => r.side === 'payee' && r.payeeId === payeeId)) : undefined)
    ?? latest(candidates.filter((r) => r.side === 'payee' && !r.payeeId));
  const client = latest(candidates.filter((r) => r.side === 'client' && !r.payeeId));
  if (!payee) return { ok: false, reason: 'missing_rate' };
  return { ok: true, rateId: payee.id, clientRateId: client?.id ?? null, clientCents: client?.rateCents ?? null, driverCents: payee.rateCents, effectiveFrom: payee.effectiveFrom };
}

/** One line of a general rate's history: the client and payee rates in force from a date. */
export interface RateStep {
  serviceTypeId: string;
  tierId: string | null;
  effectiveFrom: string;
  clientCents: Cents | null;
  driverCents: Cents | null;
  changed: ('client' | 'payee')[]; // which sides changed on this date
}

/**
 * The general rates of each service and tier as a timeline: one step per date either side changed,
 * carrying the other side's value forward. `current` is the step in force on `today`.
 */
export function rateTimeline(rates: RateRow[], today: string) {
  const general = rates.filter((r) => !r.payeeId);
  const keys = [...new Set(general.map((r) => `${r.serviceTypeId}|${r.tierId ?? ''}`))];
  return keys.map((key) => {
    const rows = general.filter((r) => `${r.serviceTypeId}|${r.tierId ?? ''}` === key);
    const dates = [...new Set(rows.map((r) => r.effectiveFrom))].sort();
    const steps: RateStep[] = dates.map((d) => {
      const side = (s: 'client' | 'payee') => latest(rows.filter((r) => r.side === s && r.effectiveFrom <= d))?.rateCents ?? null;
      return {
        serviceTypeId: rows[0]!.serviceTypeId, tierId: rows[0]!.tierId, effectiveFrom: d,
        clientCents: side('client'), driverCents: side('payee'),
        changed: (['client', 'payee'] as const).filter((s) => rows.some((r) => r.side === s && r.effectiveFrom === d)),
      };
    });
    const current = [...steps].reverse().find((s) => s.effectiveFrom <= today) ?? null;
    return { serviceTypeId: rows[0]!.serviceTypeId, tierId: rows[0]!.tierId, steps, current };
  });
}

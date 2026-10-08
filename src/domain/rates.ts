import type { Cents } from './money';

export type Tier = 't1_3' | 't4';

export interface RateRow {
  id: string;
  serviceTypeId: string;
  tier: Tier | null;
  driverId: string | null;
  contractorId: string | null;
  clientRateCents: Cents | null;
  driverRateCents: Cents | null;
  effectiveFrom: string; // YYYY-MM-DD
}

export interface Payee { driverId?: string | null; contractorId?: string | null }

export type RateLookup =
  | { ok: true; rateId: string; clientCents: Cents | null; driverCents: Cents | null; effectiveFrom: string }
  | { ok: false; reason: 'missing_rate' };

/**
 * The rate valid on `date` for a service and tier (spec §5.1). A per-driver or per-contractor
 * override wins over the general rate, each looked up independently by effective date.
 * Rates are never edited, so the latest `effectiveFrom` on or before the date is the one.
 */
export function rateFor(rates: RateRow[], serviceTypeId: string, tier: Tier | null, payee: Payee, date: string): RateLookup {
  const candidates = rates.filter((r) => r.serviceTypeId === serviceTypeId && r.tier === tier && r.effectiveFrom <= date);
  const latest = (rows: RateRow[]) => rows.reduce<RateRow | undefined>((best, r) => (!best || r.effectiveFrom > best.effectiveFrom ? r : best), undefined);
  const pick =
    (payee.driverId ? latest(candidates.filter((r) => r.driverId === payee.driverId)) : undefined) ??
    (payee.contractorId ? latest(candidates.filter((r) => r.contractorId === payee.contractorId)) : undefined) ??
    latest(candidates.filter((r) => !r.driverId && !r.contractorId));
  if (!pick || pick.driverRateCents == null) return { ok: false, reason: 'missing_rate' };
  return { ok: true, rateId: pick.id, clientCents: pick.clientRateCents, driverCents: pick.driverRateCents, effectiveFrom: pick.effectiveFrom };
}

/** General (no override) rates that are current on `date`, one per service and tier. */
export function currentGeneralRates(rates: RateRow[], date: string): RateRow[] {
  const byKey = new Map<string, RateRow>();
  for (const r of rates) {
    if (r.driverId || r.contractorId || r.effectiveFrom > date) continue;
    const key = `${r.serviceTypeId}|${r.tier ?? ''}`;
    const prev = byKey.get(key);
    if (!prev || r.effectiveFrom > prev.effectiveFrom) byKey.set(key, r);
  }
  return [...byKey.values()];
}

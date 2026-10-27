import { eq, inArray } from 'drizzle-orm';
import type { Tx } from '~/db/client';
import { serviceTiers, serviceTypes } from '~/db/schema';
import { rateFor, type RateRow } from '~/domain/rates';
import { rateRows } from './ops';

// Values work with the rates valid on its date, for any contract (stage 6c of the redesign): pieces of
// each service and tier × the payee-side rate (the driver's special rate first) and × the client rate.

export interface Piece { serviceTypeId: string; tierId: string | null; quantity: number }

export interface Valued { payCents: number; revenueCents: number; clientKnown: boolean; missing: boolean }

/** Rates, services and tiers of one operation, loaded once per calculation. */
export async function valuationContext(tx: Tx, operationId: string) {
  const services = await tx.select().from(serviceTypes).where(eq(serviceTypes.operationId, operationId));
  const tiers = services.length ? await tx.select().from(serviceTiers).where(inArray(serviceTiers.serviceTypeId, services.map((s) => s.id))) : [];
  const rows: RateRow[] = await rateRows(tx, services.map((s) => s.id));
  return { services: new Map(services.map((s) => [s.id, s])), tiers: new Map(tiers.map((t) => [t.id, t])), rows };
}

export type ValuationContext = Awaited<ReturnType<typeof valuationContext>>;

export function value(ctx: ValuationContext, pieces: Piece[], payeeId: string | null, date: string): Valued {
  let pay = 0, revenue = 0, missing = false, clientKnown = true;
  for (const p of pieces) {
    if (!p.quantity) continue;
    const r = rateFor(ctx.rows, p.serviceTypeId, p.tierId, payeeId, date);
    if (!r.ok) { missing = true; continue; }
    pay += p.quantity * r.driverCents;
    if (r.clientCents == null) clientKnown = false;
    else revenue += p.quantity * r.clientCents;
  }
  return { payCents: pay, revenueCents: revenue, clientKnown, missing };
}

/** Packages (package or piece units) and stops in some pieces, for payroll lines. */
export function counts(ctx: ValuationContext, pieces: Piece[]) {
  let packages = 0, stops = 0;
  for (const p of pieces) {
    const unit = ctx.services.get(p.serviceTypeId)?.unit;
    if (unit === 'stop') stops += p.quantity;
    else if (unit === 'package' || unit === 'piece') packages += p.quantity;
  }
  return { packages, stops };
}

/** What the client pays per unit of a service and tier on a date (general rate; null when not set). */
export function clientRate(ctx: ValuationContext, serviceTypeId: string, tierId: string | null, date: string): number | null {
  const rows = ctx.rows.filter((r) => r.side === 'client' && !r.payeeId && r.serviceTypeId === serviceTypeId && r.tierId === tierId && r.effectiveFrom <= date);
  return rows.reduce<{ d: string; c: number } | null>((best, r) => (!best || r.effectiveFrom > best.d ? { d: r.effectiveFrom, c: r.rateCents } : best), null)?.c ?? null;
}

import { and, asc, eq, isNull } from 'drizzle-orm';
import type { Tx } from '~/db/client';
import { operations, rateAgreements, rates, routes, serviceTiers, serviceTypes } from '~/db/schema';
import { todayLA } from '~/domain/dates';
import { can } from '~/domain/permissions';
import { rateTimeline } from '~/domain/rates';
import { assertCan, type Actor } from './actor';
import { audit } from './audit';
import { RuleError } from './errors';
import { contractorProfiles, createContractor, createDriver, driverProfiles, routeOwners, updateDriverProfile, type DriverInput } from './people';
import { rateRows } from './ops';
import { loadClients } from './clients';
import { refreshWeeklyLines } from './settlements';

// Drivers, contractors, services and rates (spec 6.10). Anyone signed in can read;
// only the owner edits; client rates are stripped for roles without money.view.

export interface RateView {
  id: string;
  operation: string;
  serviceCode: string;
  serviceName: string;
  unit: string;
  tierId: string | null;
  clientRateCents: number | null; // null when hidden or not set
  driverRateCents: number | null;
  effectiveFrom: string;
  current: boolean;
  reason: string | null;
}

export async function loadSetup(tx: Tx, actor: Actor, today: string) {
  assertCan(actor, 'payroll.view');
  const showMoney = can(actor.role, 'money.view');
  const ops = await tx.select().from(operations).orderBy(asc(operations.code));
  const services = await tx.select().from(serviceTypes);
  const opCode = new Map(ops.map((o) => [o.id, o.code]));
  const svc = new Map(services.map((s) => [s.id, s]));
  const tiers = await tx.select().from(serviceTiers).orderBy(asc(serviceTiers.sortOrder));
  // General rates as a timeline: one line per date either side (client or driver) changed.
  const reasons = new Map((await tx.select({ id: rates.id, reason: rateAgreements.reason }).from(rates)
    .innerJoin(rateAgreements, eq(rateAgreements.id, rates.agreementId)).where(isNull(rates.payeeId))).map((r) => [r.id, r.reason]));
  const rows = await rateRows(tx, services.map((s) => s.id));
  const reasonOf = (serviceTypeId: string, tierId: string | null, date: string) =>
    rows.filter((r) => !r.payeeId && r.serviceTypeId === serviceTypeId && r.tierId === tierId && r.effectiveFrom === date).map((r) => reasons.get(r.id)).find(Boolean) ?? null;
  const rateViews: RateView[] = rateTimeline(rows, today).flatMap((line) => line.steps.map((st) => {
    const s = svc.get(line.serviceTypeId)!;
    return {
      id: `${line.serviceTypeId}|${line.tierId ?? ''}|${st.effectiveFrom}`, operation: opCode.get(s.operationId)!, serviceCode: s.code, serviceName: s.name,
      unit: s.unit, tierId: line.tierId, clientRateCents: showMoney ? st.clientCents : null, driverRateCents: st.driverCents,
      effectiveFrom: st.effectiveFrom, current: line.current?.effectiveFrom === st.effectiveFrom, reason: reasonOf(line.serviceTypeId, line.tierId, st.effectiveFrom),
    };
  })).sort((a, b) => a.operation.localeCompare(b.operation) || a.serviceCode.localeCompare(b.serviceCode)
    || (a.tierId ?? '').localeCompare(b.tierId ?? '') || b.effectiveFrom.localeCompare(a.effectiveFrom));

  const contractorRows = await contractorProfiles(tx);
  const driverRows = await driverProfiles(tx, today);
  const routeRows = await tx.select().from(routes);
  const owner = await routeOwners(tx, today);
  return {
    showMoney,
    canEdit: can(actor.role, 'setup.edit'),
    operations: ops.map((o) => ({ id: o.id, code: o.code, name: o.name, payCycle: o.payCycle })),
    services: services.map((s) => ({
      id: s.id, operation: opCode.get(s.operationId)!, code: s.code, name: s.name, nameEs: s.nameEs, unit: s.unit, fromReport: s.fromReport,
      requiresOrderNumber: s.requiresOrderNumber, requiresNote: s.requiresNote, active: s.active,
      // Levels of the service; retired ones still label old rates and records.
      tiers: tiers.filter((t) => t.serviceTypeId === s.id).map((t) => ({ id: t.id, code: t.code, name: t.name, active: t.active })),
    })),
    rates: rateViews,
    clients: (await loadClients(tx, actor)).clients,
    contractors: contractorRows.map((c) => ({ id: c.id, name: c.name, active: c.active, routes: routeRows.filter((r) => owner.get(r.id) === c.id).map((r) => r.code) })),
    drivers: driverRows.map((d) => ({
      id: d.id, fullName: d.fullName, hovershipCode: d.hovershipCode, contractorId: d.contractorId, phone: d.phone,
      aliases: d.aliases, active: d.active, setupComplete: d.setupComplete,
      usualRoutes: routeRows.filter((r) => r.usualDriverId === d.id).map((r) => r.code),
    })),
  };
}

export interface NewRate {
  serviceTypeId: string;
  tierId: string | null;
  clientRateCents: number | null;
  driverRateCents: number | null;
  effectiveFrom: string;
  reason?: string | null;
}

/**
 * Rule 2: never update a rate in place. A change is a new agreement per side with its own start date
 * (docs/db-model.md: rate_agreements). Only the sides whose amount changes get a new rate, so a client
 * renegotiation leaves the driver's rate history alone and the other way round.
 */
export async function addRate(tx: Tx, actor: Actor, input: NewRate) {
  assertCan(actor, 'setup.edit');
  const [service] = await tx.select().from(serviceTypes).where(eq(serviceTypes.id, input.serviceTypeId));
  if (!service) throw new RuleError('unknown_service');
  const tiers = await tx.select().from(serviceTiers).where(eq(serviceTiers.serviceTypeId, service.id));
  if (tiers.some((t) => t.active) && !input.tierId) throw new RuleError('tier_required');
  if (input.tierId && !tiers.some((t) => t.id === input.tierId && t.active)) throw new RuleError('tier_not_allowed');
  if (input.clientRateCents == null && input.driverRateCents == null) throw new RuleError('amount_required');
  if ((input.clientRateCents ?? 0) < 0 || (input.driverRateCents ?? 0) < 0) throw new RuleError('invalid_amount');

  // The amount each side has on that date; only a side whose amount differs gets a new rate.
  const existing = (await rateRows(tx, [service.id])).filter((r) => !r.payeeId && r.tierId === input.tierId);
  const inForce = (side: 'client' | 'payee') => existing.filter((r) => r.side === side && r.effectiveFrom <= input.effectiveFrom)
    .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0]?.rateCents ?? null;
  const changes = ([['client', input.clientRateCents], ['payee', input.driverRateCents]] as const)
    .filter((c): c is ['client' | 'payee', number] => c[1] != null && c[1] !== inForce(c[0]));
  if (!changes.length) throw new RuleError('rate_unchanged');
  for (const [side] of changes) if (existing.some((r) => r.side === side && r.effectiveFrom === input.effectiveFrom)) throw new RuleError('rate_exists_on_date');

  let first = null;
  for (const [side, cents] of changes) {
    const [agreement] = await tx.insert(rateAgreements).values({
      operationId: service.operationId, side, effectiveFrom: input.effectiveFrom, reason: input.reason?.trim() || null, createdBy: actor.userId,
    }).returning();
    const [row] = await tx.insert(rates).values({
      agreementId: agreement!.id, side, effectiveFrom: input.effectiveFrom, serviceTypeId: service.id, tierId: input.tierId, rateCents: cents,
    }).returning();
    await audit(tx, [
      { table: 'rate_agreements', recordId: agreement!.id, action: 'insert', after: agreement, userId: actor.userId, source: actor.source },
      { table: 'rates', recordId: row!.id, action: 'insert', after: row, userId: actor.userId, source: actor.source },
    ]);
    first ??= row!;
  }
  // A new rate changes what clients are expected to pay for weeks not yet paid.
  const [op] = await tx.select({ code: operations.code }).from(operations).where(eq(operations.id, service.operationId));
  await refreshWeeklyLines(tx, actor, op!.code as 'hovership' | 'tforce');
  return first!;
}

export type { DriverInput } from './people';

export async function addDriver(tx: Tx, actor: Actor, input: DriverInput) {
  assertCan(actor, 'setup.edit');
  return createDriver(tx, actor, { ...input, setupComplete: true }, todayLA());
}

/** Saving from Drivers and rates also marks a quick-added driver as set up. */
export async function updateDriver(tx: Tx, actor: Actor, id: string, input: DriverInput) {
  assertCan(actor, 'setup.edit');
  return updateDriverProfile(tx, actor, id, { ...input, setupComplete: true }, todayLA());
}

export async function addContractor(tx: Tx, actor: Actor, name: string) {
  assertCan(actor, 'setup.edit');
  return createContractor(tx, actor, name);
}

// ---------- services (spec 6.10; decision of Oct 9, 2026: the list is kept here, not fixed in code) ----------

export interface ServiceInput {
  name: string;
  nameEs: string | null;
  requiresOrderNumber: boolean;
  requiresNote: boolean;
}

/** Code from the English name: "Hazmat pickup" → "hazmat_pickup". Codes never change once made. */
export function serviceCode(name: string) {
  return name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
}

/**
 * New services are extra-job services: agreed by phone, logged as a job, paid at the agreed amount.
 * Report services (packages, stat, e-commerce) come from the client files and can't be created here.
 */
export async function addService(tx: Tx, actor: Actor, input: ServiceInput & { operation: 'tforce' | 'hovership' }) {
  assertCan(actor, 'setup.edit');
  const name = input.name.trim();
  if (!name) throw new RuleError('name_required');
  const code = serviceCode(name);
  if (!code) throw new RuleError('name_required');
  const [op] = await tx.select().from(operations).where(eq(operations.code, input.operation));
  if (!op) throw new RuleError('unknown_service');
  const [clash] = await tx.select({ id: serviceTypes.id }).from(serviceTypes).where(and(eq(serviceTypes.operationId, op.id), eq(serviceTypes.code, code)));
  if (clash) throw new RuleError('name_taken');
  const [row] = await tx.insert(serviceTypes).values({
    operationId: op.id, code, name, nameEs: input.nameEs?.trim() || null, unit: 'job', fromReport: false,
    requiresOrderNumber: input.requiresOrderNumber, requiresNote: input.requiresNote,
  }).returning();
  await audit(tx, { table: 'service_types', recordId: row!.id, action: 'insert', after: row, userId: actor.userId, source: actor.source });
  return row!;
}

/** Edits labels and rules. Code, unit and operation never change, so past records keep their meaning. */
export async function updateService(tx: Tx, actor: Actor, id: string, input: ServiceInput & { active: boolean }) {
  assertCan(actor, 'setup.edit');
  const [before] = await tx.select().from(serviceTypes).where(eq(serviceTypes.id, id));
  if (!before) throw new RuleError('not_found');
  const name = input.name.trim();
  if (!name) throw new RuleError('name_required');
  // Report services feed the imports; turning them off would leave report rows without a service.
  if (before.fromReport && !input.active) throw new RuleError('service_from_report');
  const values = before.fromReport
    ? { name, nameEs: input.nameEs?.trim() || null }
    : { name, nameEs: input.nameEs?.trim() || null, requiresOrderNumber: input.requiresOrderNumber, requiresNote: input.requiresNote, active: input.active };
  const [after] = await tx.update(serviceTypes).set(values).where(eq(serviceTypes.id, id)).returning();
  await audit(tx, { table: 'service_types', recordId: id, action: 'update', before, after, userId: actor.userId, source: actor.source });
  return after!;
}

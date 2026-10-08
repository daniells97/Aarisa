import { and, asc, eq, isNull } from 'drizzle-orm';
import type { Tx } from '~/db/client';
import { contractors, drivers, operations, rates, routes, serviceTypes } from '~/db/schema';
import { can } from '~/domain/permissions';
import { currentGeneralRates, type RateRow } from '~/domain/rates';
import { assertCan, type Actor } from './actor';
import { audit } from './audit';
import { RuleError } from './errors';

// Drivers, contractors, services and rates (spec 6.10). Anyone signed in can read;
// only the owner edits; client rates are stripped for roles without money.view.

export interface RateView {
  id: string;
  operation: string;
  serviceCode: string;
  serviceName: string;
  unit: string;
  tier: 't1_3' | 't4' | null;
  clientRateCents: number | null; // null when hidden or not set
  driverRateCents: number | null;
  effectiveFrom: string;
  current: boolean;
}

export async function loadSetup(tx: Tx, actor: Actor, today: string) {
  assertCan(actor, 'payroll.view');
  const showMoney = can(actor.role, 'money.view');
  const ops = await tx.select().from(operations).orderBy(asc(operations.code));
  const services = await tx.select().from(serviceTypes);
  const allRates = (await tx.select().from(rates).where(and(isNull(rates.driverId), isNull(rates.contractorId)))) as RateRow[];
  const current = new Set(currentGeneralRates(allRates, today).map((r) => r.id));
  const opCode = new Map(ops.map((o) => [o.id, o.code]));
  const svc = new Map(services.map((s) => [s.id, s]));
  const rateViews: RateView[] = allRates.map((r) => {
    const s = svc.get(r.serviceTypeId)!;
    return {
      id: r.id, operation: opCode.get(s.operationId)!, serviceCode: s.code, serviceName: s.name, unit: s.unit, tier: r.tier,
      clientRateCents: showMoney ? r.clientRateCents : null,
      driverRateCents: r.driverRateCents, effectiveFrom: r.effectiveFrom, current: current.has(r.id),
    };
  }).sort((a, b) => a.operation.localeCompare(b.operation) || a.serviceCode.localeCompare(b.serviceCode)
    || (a.tier ?? '').localeCompare(b.tier ?? '') || b.effectiveFrom.localeCompare(a.effectiveFrom));

  const contractorRows = await tx.select().from(contractors).orderBy(asc(contractors.name));
  const driverRows = await tx.select().from(drivers).orderBy(asc(drivers.fullName));
  const routeRows = await tx.select().from(routes);
  return {
    showMoney,
    canEdit: can(actor.role, 'setup.edit'),
    operations: ops.map((o) => ({ id: o.id, code: o.code, name: o.name, payCycle: o.payCycle })),
    services: services.map((s) => ({ id: s.id, operation: opCode.get(s.operationId)!, code: s.code, name: s.name, unit: s.unit, fromReport: s.fromReport, requiresOrderNumber: s.requiresOrderNumber, requiresNote: s.requiresNote })),
    rates: rateViews,
    contractors: contractorRows.map((c) => ({ id: c.id, name: c.name, active: c.active, routes: routeRows.filter((r) => r.contractorId === c.id).map((r) => r.code) })),
    drivers: driverRows.map((d) => ({
      id: d.id, fullName: d.fullName, hovershipCode: d.hovershipCode, contractorId: d.contractorId, phone: d.phone,
      aliases: d.aliases, active: d.active, setupComplete: d.setupComplete,
      usualRoutes: routeRows.filter((r) => r.usualDriverId === d.id).map((r) => r.code),
    })),
  };
}

export interface NewRate {
  serviceTypeId: string;
  tier: 't1_3' | 't4' | null;
  clientRateCents: number | null;
  driverRateCents: number | null;
  effectiveFrom: string;
}

/** Rule 2: never update a rate in place; a change is a new row with its own start date. */
export async function addRate(tx: Tx, actor: Actor, input: NewRate) {
  assertCan(actor, 'setup.edit');
  const [service] = await tx.select().from(serviceTypes).where(eq(serviceTypes.id, input.serviceTypeId));
  if (!service) throw new RuleError('unknown_service');
  if (service.code === 'hovership_packages' && !input.tier) throw new RuleError('tier_required');
  if (service.code !== 'hovership_packages' && input.tier) throw new RuleError('tier_not_allowed');
  if (input.clientRateCents == null && input.driverRateCents == null) throw new RuleError('amount_required');
  const clash = await tx.select({ id: rates.id }).from(rates).where(and(
    eq(rates.serviceTypeId, input.serviceTypeId), input.tier ? eq(rates.tier, input.tier) : isNull(rates.tier),
    isNull(rates.driverId), isNull(rates.contractorId), eq(rates.effectiveFrom, input.effectiveFrom),
  ));
  if (clash.length) throw new RuleError('rate_exists_on_date');
  const [row] = await tx.insert(rates).values({ ...input, createdBy: actor.userId }).returning();
  await audit(tx, { table: 'rates', recordId: row!.id, action: 'insert', after: row, userId: actor.userId, source: actor.source });
  return row!;
}

export interface DriverInput {
  fullName: string;
  hovershipCode: string | null;
  contractorId: string | null;
  phone: string | null;
  aliases: string[];
  active: boolean;
}

function clean(input: DriverInput) {
  return {
    fullName: input.fullName.trim(),
    hovershipCode: input.hovershipCode?.trim().toUpperCase() || null,
    contractorId: input.contractorId || null,
    phone: input.phone?.trim() || null,
    aliases: [...new Set(input.aliases.map((a) => a.trim()).filter(Boolean))],
    active: input.active,
  };
}

async function assertCodeFree(tx: Tx, code: string | null, exceptId?: string) {
  if (!code) return;
  const [other] = await tx.select({ id: drivers.id }).from(drivers).where(eq(drivers.hovershipCode, code));
  if (other && other.id !== exceptId) throw new RuleError('code_taken');
}

export async function addDriver(tx: Tx, actor: Actor, input: DriverInput) {
  assertCan(actor, 'setup.edit');
  const values = clean(input);
  if (!values.fullName) throw new RuleError('name_required');
  await assertCodeFree(tx, values.hovershipCode);
  const [row] = await tx.insert(drivers).values({ ...values, setupComplete: true }).returning();
  await audit(tx, { table: 'drivers', recordId: row!.id, action: 'insert', after: row, userId: actor.userId, source: actor.source });
  return row!;
}

export async function updateDriver(tx: Tx, actor: Actor, id: string, input: DriverInput) {
  assertCan(actor, 'setup.edit');
  const [before] = await tx.select().from(drivers).where(eq(drivers.id, id));
  if (!before) throw new RuleError('not_found');
  const values = clean(input);
  if (!values.fullName) throw new RuleError('name_required');
  await assertCodeFree(tx, values.hovershipCode, id);
  const [after] = await tx.update(drivers).set({ ...values, setupComplete: true, updatedAt: new Date() }).where(eq(drivers.id, id)).returning();
  await audit(tx, { table: 'drivers', recordId: id, action: 'update', before, after, userId: actor.userId, source: actor.source });
  return after!;
}

export async function addContractor(tx: Tx, actor: Actor, name: string) {
  assertCan(actor, 'setup.edit');
  const trimmed = name.trim();
  if (!trimmed) throw new RuleError('name_required');
  const [existing] = await tx.select({ id: contractors.id }).from(contractors).where(eq(contractors.name, trimmed));
  if (existing) throw new RuleError('name_taken');
  const [row] = await tx.insert(contractors).values({ name: trimmed }).returning();
  await audit(tx, { table: 'contractors', recordId: row!.id, action: 'insert', after: row, userId: actor.userId, source: actor.source });
  return row!;
}

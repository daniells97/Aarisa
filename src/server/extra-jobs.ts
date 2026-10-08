import { and, asc, desc, eq, gte, inArray, lte } from 'drizzle-orm';
import type { Tx } from '~/db/client';
import { contractors, drivers, extraJobs, routes, serviceTypes, settlementLines, users, workRecords } from '~/db/schema';
import { addDays } from '~/domain/dates';
import { can } from '~/domain/permissions';
import { assertCan, type Actor } from './actor';
import { audit, type AuditEntry } from './audit';
import { RuleError } from './errors';
import { assertNotLocked, getOperation } from './ops';

// Extra jobs (spec §5.4, 6.6): T-Force work agreed by phone that never shows in the weekly report.
// Each job is one work record (paid at the agreed amount) and one expected settlement line.

export const EXTRA_SERVICES = ['recovery_route', 'pickup', 'grainger', 'other'] as const;
export type ExtraService = (typeof EXTRA_SERVICES)[number];

export interface ExtraJobInput {
  clientUuid: string; // made on the phone, so a retry or an offline resend never creates a second job
  service: ExtraService;
  date: string;
  nearRouteId: string | null;
  payee: { driverId: string } | { contractorId: string };
  clientAmountCents: number | null; // what T-Force pays; only money roles may set it
  driverAmountCents: number;
  orderNumber: string | null;
  note: string | null;
  aiSuggestionId?: string | null;
}

/** What still needs a person, shown on the job card (Mobile-Synced design). */
export function missingFields(j: { serviceCode: string; clientAmountCents: number | null; orderNumber: string | null }) {
  const out: ('client_amount' | 'order_number')[] = [];
  if (j.clientAmountCents == null) out.push('client_amount');
  if (!j.orderNumber) out.push('order_number');
  return out;
}

export async function createExtraJob(tx: Tx, actor: Actor, input: ExtraJobInput) {
  assertCan(actor, 'extra_jobs.log');
  const [existing] = await tx.select().from(extraJobs).where(eq(extraJobs.clientUuid, input.clientUuid));
  if (existing) return { job: existing, created: false };

  const op = await getOperation(tx, 'tforce');
  await assertNotLocked(tx, op, input.date);
  const [service] = await tx.select().from(serviceTypes).where(and(eq(serviceTypes.operationId, op.id), eq(serviceTypes.code, input.service)));
  if (!service) throw new RuleError('unknown_service');
  const orderNumber = input.orderNumber?.trim() || null;
  const note = input.note?.trim() || null;
  if (service.requiresOrderNumber && !orderNumber) throw new RuleError('order_number_required');
  if (service.requiresNote && !note) throw new RuleError('note_required');
  if (input.clientAmountCents != null && !can(actor.role, 'money.view')) throw new RuleError('client_amount_not_allowed');
  if (input.driverAmountCents < 0 || (input.clientAmountCents ?? 0) < 0) throw new RuleError('invalid_amount');
  const payee = 'driverId' in input.payee ? { driverId: input.payee.driverId, contractorId: null } : { driverId: null, contractorId: input.payee.contractorId };
  if (payee.driverId && !(await tx.select({ id: drivers.id }).from(drivers).where(eq(drivers.id, payee.driverId))).length) throw new RuleError('not_found');
  if (payee.contractorId && !(await tx.select({ id: contractors.id }).from(contractors).where(eq(contractors.id, payee.contractorId))).length) throw new RuleError('not_found');

  const source = actor.source === 'whatsapp' ? 'whatsapp' as const : 'extra_job' as const;
  const trail: AuditEntry[] = [];
  const log = (table: string, row: { id: string }) => trail.push({ table, recordId: row.id, action: 'insert', after: row, userId: actor.userId, source: actor.source });

  const [job] = await tx.insert(extraJobs).values({
    clientUuid: input.clientUuid, operationId: op.id, serviceTypeId: service.id, date: input.date, nearRouteId: input.nearRouteId,
    ...payee, clientAmountCents: input.clientAmountCents, driverAmountCents: input.driverAmountCents, orderNumber, note,
    source, aiSuggestionId: input.aiSuggestionId ?? null, createdBy: actor.userId,
  }).returning();
  log('extra_jobs', job!);
  // One unit of work at the agreed amounts (the "rate" of a job is its amount).
  const [work] = await tx.insert(workRecords).values({
    date: input.date, operationId: op.id, serviceTypeId: service.id, routeId: input.nearRouteId, ...payee, pieces: 1,
    clientRateCents: input.clientAmountCents, driverRateCents: input.driverAmountCents, source: 'extra_job', extraJobId: job!.id,
  }).returning();
  log('work_records', work!);
  // T-Force pays it as a manual adjustment, so it is tracked until it shows up in a settlement.
  const [line] = await tx.insert(settlementLines).values({
    operationId: op.id, kind: 'extra_job', reference: orderNumber ?? `${service.name} ${input.date}`, periodStart: input.date, periodEnd: input.date,
    extraJobId: job!.id, expectedCents: input.clientAmountCents, expectedDate: addDays(input.date, op.paymentTermsDays), status: 'open',
  }).returning();
  log('settlement_lines', line!);
  const [linked] = await tx.update(workRecords).set({ settlementLineId: line!.id }).where(eq(workRecords.id, work!.id)).returning();
  trail.push({ table: 'work_records', recordId: work!.id, action: 'update', before: work, after: linked, userId: actor.userId, source: actor.source });
  await audit(tx, trail);
  return { job: job!, created: true };
}

/** Fill in what was missing on a job card (Mobile-Synced design). */
export async function completeExtraJob(tx: Tx, actor: Actor, id: string, patch: { orderNumber?: string | null; clientAmountCents?: number | null }) {
  // What T-Force pays is money (owner, finance); the order number belongs to whoever logs jobs.
  if (patch.clientAmountCents !== undefined) {
    if (actor.role === 'dispatcher') throw new RuleError('client_amount_not_allowed');
    assertCan(actor, 'settlements.record');
  }
  if (patch.orderNumber !== undefined) assertCan(actor, 'extra_jobs.log');
  const [before] = await tx.select().from(extraJobs).where(eq(extraJobs.id, id));
  if (!before) throw new RuleError('not_found');
  const op = await getOperation(tx, 'tforce');
  await assertNotLocked(tx, op, before.date);
  const values = {
    ...(patch.orderNumber !== undefined ? { orderNumber: patch.orderNumber?.trim() || null } : {}),
    ...(patch.clientAmountCents !== undefined ? { clientAmountCents: patch.clientAmountCents } : {}),
    updatedAt: new Date(),
  };
  const [after] = await tx.update(extraJobs).set(values).where(eq(extraJobs.id, id)).returning();
  const trail: AuditEntry[] = [{ table: 'extra_jobs', recordId: id, action: 'update', before, after, userId: actor.userId, source: actor.source }];
  if (patch.clientAmountCents !== undefined) {
    const [w] = await tx.select().from(workRecords).where(eq(workRecords.extraJobId, id));
    if (w) {
      const [wa] = await tx.update(workRecords).set({ clientRateCents: patch.clientAmountCents, updatedAt: new Date() }).where(eq(workRecords.id, w.id)).returning();
      trail.push({ table: 'work_records', recordId: w.id, action: 'update', before: w, after: wa, userId: actor.userId, source: actor.source });
    }
  }
  const [line] = await tx.select().from(settlementLines).where(eq(settlementLines.extraJobId, id));
  if (line) {
    const [la] = await tx.update(settlementLines).set({
      ...(patch.clientAmountCents !== undefined ? { expectedCents: patch.clientAmountCents } : {}),
      ...(patch.orderNumber ? { reference: patch.orderNumber.trim() } : {}),
      updatedAt: new Date(),
    }).where(eq(settlementLines.id, line.id)).returning();
    trail.push({ table: 'settlement_lines', recordId: line.id, action: 'update', before: line, after: la, userId: actor.userId, source: actor.source });
  }
  await audit(tx, trail);
  return after!;
}

export async function listExtraJobs(tx: Tx, actor: Actor, from: string, to: string) {
  assertCan(actor, 'payroll.view');
  const showMoney = can(actor.role, 'money.view');
  const op = await getOperation(tx, 'tforce');
  const rows = await tx.select({ job: extraJobs, service: serviceTypes, route: routes.code, by: users.name })
    .from(extraJobs).innerJoin(serviceTypes, eq(serviceTypes.id, extraJobs.serviceTypeId))
    .leftJoin(routes, eq(routes.id, extraJobs.nearRouteId)).leftJoin(users, eq(users.id, extraJobs.createdBy))
    .where(and(eq(extraJobs.operationId, op.id), gte(extraJobs.date, from), lte(extraJobs.date, to)))
    .orderBy(desc(extraJobs.date), desc(extraJobs.createdAt));
  const dIds = rows.map((r) => r.job.driverId).filter((x): x is string => !!x);
  const cIds = rows.map((r) => r.job.contractorId).filter((x): x is string => !!x);
  const dName = new Map((dIds.length ? await tx.select({ id: drivers.id, n: drivers.fullName }).from(drivers).where(inArray(drivers.id, dIds)) : []).map((d) => [d.id, d.n]));
  const cName = new Map((cIds.length ? await tx.select({ id: contractors.id, n: contractors.name }).from(contractors).where(inArray(contractors.id, cIds)) : []).map((c) => [c.id, c.n]));
  return {
    showMoney,
    canLog: can(actor.role, 'extra_jobs.log'),
    jobs: rows.map(({ job, service, route, by }) => ({
      id: job.id, date: job.date, service: service.code, serviceName: service.name, nearRoute: route ?? null,
      payee: job.driverId ? dName.get(job.driverId) ?? '' : cName.get(job.contractorId!) ?? '', contractor: !!job.contractorId,
      clientAmountCents: showMoney ? job.clientAmountCents : null, driverAmountCents: job.driverAmountCents,
      orderNumber: job.orderNumber, note: job.note, source: job.source, by: by ?? null, createdAt: job.createdAt.toISOString(),
      missing: missingFields({ serviceCode: service.code, clientAmountCents: job.clientAmountCents, orderNumber: job.orderNumber }),
    })),
  };
}

/** Choices for the form: services, routes, people. */
export async function extraJobOptions(tx: Tx, actor: Actor) {
  assertCan(actor, 'extra_jobs.log');
  const op = await getOperation(tx, 'tforce');
  const services = await tx.select().from(serviceTypes).where(and(eq(serviceTypes.operationId, op.id), inArray(serviceTypes.code, [...EXTRA_SERVICES])));
  return {
    showMoney: can(actor.role, 'money.view'),
    services: EXTRA_SERVICES.map((code) => services.find((s) => s.code === code)!).filter(Boolean).map((s) => ({ code: s.code as ExtraService, name: s.name, requiresOrderNumber: s.requiresOrderNumber, requiresNote: s.requiresNote })),
    routes: (await tx.select({ id: routes.id, code: routes.code }).from(routes).where(and(eq(routes.operationId, op.id), eq(routes.active, true))).orderBy(asc(routes.code))),
    drivers: (await tx.select({ id: drivers.id, name: drivers.fullName }).from(drivers).where(eq(drivers.active, true)).orderBy(asc(drivers.fullName))),
    contractors: (await tx.select({ id: contractors.id, name: contractors.name }).from(contractors).where(eq(contractors.active, true)).orderBy(asc(contractors.name))),
  };
}

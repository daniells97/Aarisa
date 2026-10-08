import { and, desc, eq, gte, inArray, lte } from 'drizzle-orm';
import type { Tx } from '~/db/client';
import { aiSuggestions, claims, contractors, drivers, extraJobs, operations, paymentAllocations, paymentsReceived, payrollRuns, rates, routes, serviceTypes, settlementLines, workRecords } from '~/db/schema';
import { addDays, weekStart } from '~/domain/dates';
import { valueDay } from '~/domain/hovership';
import { can } from '~/domain/permissions';
import { rateFor, type RateRow } from '~/domain/rates';
import { settlementStatus, settlementSummary, type SettlementStatus } from '~/domain/settlements';
import { assertCan, type Actor } from './actor';
import { audit, type AuditEntry } from './audit';
import { RuleError } from './errors';
import { loadHovershipDays } from './hovership';
import { getOperation, hovershipRateFn, serviceIds } from './ops';

// Settlements (spec §5.6, 6.9): what each client is expected to pay, what arrived, what is late,
// and claims for money paid out to drivers but left out by the client.

type Op = Awaited<ReturnType<typeof getOperation>>;

/** Expected weekly amount: Hovership invoice (packages, stat and STEM); T-Force e-commerce pieces. Null when a rate is missing. */
async function weeklyExpected(tx: Tx, op: Op, start: string, end: string): Promise<number | null> {
  if (op.code === 'hovership') {
    const { fn: rate, ids } = await hovershipRateFn(tx, op.id);
    const { days, stemCents } = await loadHovershipDays(tx, op.id, ids, start, end);
    const valued = days.map((d) => valueDay(d, rate));
    if (valued.some((v) => v.missing.length)) return null;
    return valued.reduce((s, v) => s + v.revenueCents, 0) + stemCents;
  }
  const ids = await serviceIds(tx, op.id);
  const rateRows = (await tx.select().from(rates).where(eq(rates.serviceTypeId, ids.ecommerce!))) as RateRow[];
  const records = await tx.select().from(workRecords).where(and(eq(workRecords.operationId, op.id), eq(workRecords.source, 'tforce_report'), gte(workRecords.date, start), lte(workRecords.date, end)));
  let total = 0;
  for (const w of records) {
    if (!w.driverId && !w.contractorId) continue; // not our route: not billed
    const r = rateFor(rateRows, ids.ecommerce!, null, { driverId: w.driverId, contractorId: w.contractorId }, w.date);
    if (!r.ok || r.clientCents == null) return null;
    total += w.pieces * r.clientCents;
  }
  return total;
}

/**
 * Creates or updates the weekly expected line for each week that has report work.
 * Runs after a report import, a rate change or a weekly-check resolution. Paid lines are not touched.
 */
export async function refreshWeeklyLines(tx: Tx, actor: Actor, code: 'hovership' | 'tforce', weekStarts?: string[]) {
  const op = await getOperation(tx, code);
  const kind = code === 'hovership' ? 'hovership_invoice' as const : 'tforce_weekly' as const;
  const source = code === 'hovership' ? 'hovership_report' as const : 'tforce_report' as const;
  let weeks = weekStarts;
  if (!weeks) {
    const dates = await tx.selectDistinct({ date: workRecords.date }).from(workRecords).where(and(eq(workRecords.operationId, op.id), eq(workRecords.source, source)));
    weeks = [...new Set(dates.map((d) => weekStart(d.date)))];
  }
  const trail: AuditEntry[] = [];
  for (const start of weeks.sort()) {
    const end = addDays(start, 6);
    const expected = await weeklyExpected(tx, op, start, end);
    const expectedDate = addDays(end, op.paymentTermsDays);
    const [line] = await tx.select().from(settlementLines).where(and(eq(settlementLines.operationId, op.id), eq(settlementLines.kind, kind), eq(settlementLines.periodStart, start)));
    if (!line) {
      const [row] = await tx.insert(settlementLines).values({ operationId: op.id, kind, periodStart: start, periodEnd: end, expectedCents: expected, expectedDate, status: 'open' }).returning();
      trail.push({ table: 'settlement_lines', recordId: row!.id, action: 'insert', after: row, userId: actor.userId, source: actor.source });
    } else if (line.status !== 'paid' && (line.expectedCents !== expected || line.expectedDate !== expectedDate)) {
      const [row] = await tx.update(settlementLines).set({ expectedCents: expected, expectedDate, updatedAt: new Date() }).where(eq(settlementLines.id, line.id)).returning();
      trail.push({ table: 'settlement_lines', recordId: line.id, action: 'update', before: line, after: row, userId: actor.userId, source: actor.source });
    }
  }
  await audit(tx, trail);
}

async function receivedByLine(tx: Tx, lineIds: string[]) {
  const map = new Map<string, { cents: number; lastDate: string | null }>();
  if (!lineIds.length) return map;
  const rows = await tx.select({ lineId: paymentAllocations.settlementLineId, amount: paymentAllocations.amountCents, date: paymentsReceived.receivedOn })
    .from(paymentAllocations).innerJoin(paymentsReceived, eq(paymentsReceived.id, paymentAllocations.paymentId)).where(inArray(paymentAllocations.settlementLineId, lineIds));
  for (const r of rows) {
    const e = map.get(r.lineId) ?? { cents: 0, lastDate: null };
    e.cents += r.amount;
    e.lastDate = !e.lastDate || r.date > e.lastDate ? r.date : e.lastDate;
    map.set(r.lineId, e);
  }
  return map;
}

/** Was the driver or contractor already paid for this line's work (its payroll run approved or paid)? */
async function paidOutLines(tx: Tx, lines: (typeof settlementLines.$inferSelect)[]) {
  const out = new Set<string>();
  const approved = new Set((await tx.select({ id: payrollRuns.id }).from(payrollRuns).where(inArray(payrollRuns.status, ['approved', 'paid']))).map((r) => r.id));
  if (!approved.size) return out;
  for (const l of lines) {
    const recs = l.extraJobId
      ? await tx.select({ run: workRecords.payrollRunId }).from(workRecords).where(eq(workRecords.extraJobId, l.extraJobId))
      : await tx.select({ run: workRecords.payrollRunId }).from(workRecords).where(and(eq(workRecords.operationId, l.operationId), gte(workRecords.date, l.periodStart ?? '9999-12-31'), lte(workRecords.date, l.periodEnd ?? '0000-01-01')));
    if (recs.length && recs.every((r) => r.run && approved.has(r.run))) out.add(l.id);
  }
  return out;
}

export async function loadSettlements(tx: Tx, actor: Actor, today: string, filter: 'all' | 'hovership' | 'tforce' = 'all') {
  assertCan(actor, 'money.view');
  const ops = await tx.select().from(operations);
  const opCode = new Map(ops.map((o) => [o.id, o.code]));
  let lines = await tx.select().from(settlementLines).orderBy(desc(settlementLines.expectedDate));
  if (filter !== 'all') lines = lines.filter((l) => opCode.get(l.operationId) === filter);
  const ids = lines.map((l) => l.id);
  const received = await receivedByLine(tx, ids);
  const claimRows = ids.length ? await tx.select().from(claims).where(inArray(claims.settlementLineId, ids)).orderBy(desc(claims.createdAt)) : [];
  const paidOut = await paidOutLines(tx, lines);
  const jobIds = lines.map((l) => l.extraJobId).filter((x): x is string => !!x);
  const jobs = jobIds.length ? await tx.select({ job: extraJobs, service: serviceTypes.name, route: routes.code }).from(extraJobs)
    .innerJoin(serviceTypes, eq(serviceTypes.id, extraJobs.serviceTypeId)).leftJoin(routes, eq(routes.id, extraJobs.nearRouteId)).where(inArray(extraJobs.id, jobIds)) : [];
  const dName = new Map((await tx.select({ id: drivers.id, n: drivers.fullName }).from(drivers)).map((d) => [d.id, d.n]));
  const cName = new Map((await tx.select({ id: contractors.id, n: contractors.name }).from(contractors)).map((c) => [c.id, c.n]));

  const view = lines.map((l) => {
    const rec = received.get(l.id) ?? { cents: 0, lastDate: null };
    const lineClaims = claimRows.filter((c) => c.settlementLineId === l.id);
    const claim = lineClaims.some((c) => c.status === 'sent') ? 'sent' as const : l.status === 'claim_ready' || l.status === 'claimed' || lineClaims.length ? 'ready' as const : 'none' as const;
    const s = settlementStatus({ expectedCents: l.expectedCents, expectedDate: l.expectedDate, receivedCents: rec.cents, claim }, today);
    const j = jobs.find((x) => x.job.id === l.extraJobId);
    return {
      id: l.id, operation: opCode.get(l.operationId)!, kind: l.kind, reference: l.reference, periodStart: l.periodStart, periodEnd: l.periodEnd,
      expectedCents: l.expectedCents, expectedDate: l.expectedDate, receivedCents: rec.cents, paidOn: s.status === 'paid' ? rec.lastDate : null,
      missingCents: s.missingCents, daysLate: s.daysLate, status: s.status as SettlementStatus, paidToPayee: paidOut.has(l.id),
      claimSentAt: lineClaims.find((c) => c.status === 'sent')?.sentAt?.toISOString() ?? null, claimSentTo: lineClaims.find((c) => c.status === 'sent')?.sentTo ?? null,
      job: j ? {
        service: j.service, date: j.job.date, orderNumber: j.job.orderNumber, nearRoute: j.route ?? null,
        payee: j.job.driverId ? dName.get(j.job.driverId) ?? '' : cName.get(j.job.contractorId!) ?? '', contractor: !!j.job.contractorId,
        clientAmountCents: j.job.clientAmountCents, payeeAmountCents: j.job.driverAmountCents, source: j.job.source, viaAi: !!j.job.aiSuggestionId,
      } : null,
    };
  });

  const payments = await tx.select().from(paymentsReceived).orderBy(desc(paymentsReceived.receivedOn));
  // "Received in <last month>" (design 6.9).
  const monthStart = `${today.slice(0, 7)}-01`;
  const prevMonthStart = `${addDays(monthStart, -1).slice(0, 7)}-01`;
  const summary = settlementSummary(
    view.map((v) => ({ expectedCents: v.expectedCents, expectedDate: v.expectedDate, receivedCents: v.receivedCents, claim: v.claimSentAt ? 'sent' as const : v.status === 'claim_ready' ? 'ready' as const : 'none' as const, operation: v.operation, kind: v.kind, paidToPayee: v.paidToPayee })),
    today, { start: prevMonthStart, end: addDays(monthStart, -1) },
    payments.filter((p) => filter === 'all' || opCode.get(p.operationId) === filter).map((p) => ({ date: p.receivedOn, amountCents: p.amountCents })),
  );
  return {
    today, filter, canRecord: can(actor.role, 'settlements.record'), lines: view, summary, previousMonth: prevMonthStart,
    payments: payments.filter((p) => filter === 'all' || opCode.get(p.operationId) === filter).map((p) => ({ id: p.id, operation: opCode.get(p.operationId)!, receivedOn: p.receivedOn, amountCents: p.amountCents, method: p.method, reference: p.reference, note: p.note })),
  };
}

export interface PaymentInput {
  operation: 'hovership' | 'tforce';
  receivedOn: string;
  amountCents: number;
  method: string | null;
  reference: string | null;
  note: string | null;
  allocations: { lineId: string; amountCents: number }[];
}

/** Finance records money that arrived and says which expected lines it pays. */
export async function recordPayment(tx: Tx, actor: Actor, input: PaymentInput) {
  assertCan(actor, 'settlements.record');
  if (input.amountCents <= 0) throw new RuleError('invalid_amount');
  const allocated = input.allocations.reduce((s, a) => s + a.amountCents, 0);
  if (allocated > input.amountCents) throw new RuleError('allocations_exceed_payment');
  if (input.allocations.some((a) => a.amountCents <= 0)) throw new RuleError('invalid_amount');
  const op = await getOperation(tx, input.operation);
  const lineIds = input.allocations.map((a) => a.lineId);
  const lines = lineIds.length ? await tx.select().from(settlementLines).where(inArray(settlementLines.id, lineIds)) : [];
  if (lines.length !== new Set(lineIds).size || lines.some((l) => l.operationId !== op.id)) throw new RuleError('line_not_found');

  const [payment] = await tx.insert(paymentsReceived).values({
    operationId: op.id, receivedOn: input.receivedOn, amountCents: input.amountCents, method: input.method, reference: input.reference, note: input.note, createdBy: actor.userId,
  }).returning();
  const trail: AuditEntry[] = [{ table: 'payments_received', recordId: payment!.id, action: 'insert', after: payment, userId: actor.userId, source: actor.source }];
  if (input.allocations.length) {
    const rows = await tx.insert(paymentAllocations).values(input.allocations.map((a) => ({ paymentId: payment!.id, settlementLineId: a.lineId, amountCents: a.amountCents }))).returning();
    for (const r of rows) trail.push({ table: 'payment_allocations', recordId: r.id, action: 'insert', after: r, userId: actor.userId, source: actor.source });
  }
  // Keep the stored status in step for lines this payment completes.
  const received = await receivedByLine(tx, lineIds);
  for (const l of lines) {
    const got = received.get(l.id)?.cents ?? 0;
    if (l.expectedCents != null && got >= l.expectedCents && l.status !== 'paid') {
      const [after] = await tx.update(settlementLines).set({ status: 'paid', updatedAt: new Date() }).where(eq(settlementLines.id, l.id)).returning();
      trail.push({ table: 'settlement_lines', recordId: l.id, action: 'update', before: l, after, userId: actor.userId, source: actor.source });
    }
  }
  await audit(tx, trail);
  return payment!;
}

/** Marks a line as missing from the client's payment, ready to claim. */
export async function markClaimReady(tx: Tx, actor: Actor, lineId: string) {
  assertCan(actor, 'settlements.record');
  const [before] = await tx.select().from(settlementLines).where(eq(settlementLines.id, lineId));
  if (!before) throw new RuleError('line_not_found');
  if (before.status === 'paid') throw new RuleError('already_paid');
  const [after] = await tx.update(settlementLines).set({ status: 'claim_ready', updatedAt: new Date() }).where(eq(settlementLines.id, lineId)).returning();
  await audit(tx, { table: 'settlement_lines', recordId: lineId, action: 'update', before, after, userId: actor.userId, source: actor.source });
  return after!;
}

/** Records that the claim was sent (by email or handed over at the client meeting). */
export async function markClaimSent(tx: Tx, actor: Actor, lineId: string, sentTo: string | null) {
  assertCan(actor, 'settlements.record');
  const [line] = await tx.select().from(settlementLines).where(eq(settlementLines.id, lineId));
  if (!line) throw new RuleError('line_not_found');
  if (line.status === 'paid') throw new RuleError('already_paid');
  const [claim] = await tx.insert(claims).values({ settlementLineId: lineId, status: 'sent', sentTo, sentAt: new Date(), createdBy: actor.userId }).returning();
  const [after] = await tx.update(settlementLines).set({ status: 'claimed', updatedAt: new Date() }).where(eq(settlementLines.id, lineId)).returning();
  await audit(tx, [
    { table: 'claims', recordId: claim!.id, action: 'insert', after: claim, userId: actor.userId, source: actor.source },
    { table: 'settlement_lines', recordId: lineId, action: 'update', before: line, after, userId: actor.userId, source: actor.source },
  ]);
  return claim!;
}

/** Everything a claim needs (spec §5.6): order, date, route, who, agreed, paid out, and the phone agreement log. */
export async function claimDetails(tx: Tx, actor: Actor, lineId: string, today: string) {
  assertCan(actor, 'money.view');
  const all = await loadSettlements(tx, actor, today, 'all');
  const line = all.lines.find((l) => l.id === lineId);
  if (!line) throw new RuleError('line_not_found');
  let agreement: { at: string; text: string } | null = null;
  const [row] = await tx.select({ extraJobId: settlementLines.extraJobId }).from(settlementLines).where(eq(settlementLines.id, lineId));
  if (row?.extraJobId) {
    const [job] = await tx.select().from(extraJobs).where(eq(extraJobs.id, row.extraJobId));
    // The phone agreement: the WhatsApp message the job came from, else the note typed when it was logged.
    if (job?.aiSuggestionId) {
      const [s] = await tx.select().from(aiSuggestions).where(eq(aiSuggestions.id, job.aiSuggestionId));
      if (s) agreement = { at: s.createdAt.toISOString(), text: s.inputText };
    } else if (job) {
      agreement = { at: job.createdAt.toISOString(), text: job.note ?? '' };
    }
  }
  return { line, agreement, checklist: { orderNumber: !!line.job?.orderNumber, agreementLogged: !!agreement, sent: !!line.claimSentAt } };
}


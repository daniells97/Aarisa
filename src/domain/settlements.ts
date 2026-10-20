import { daysBetween } from './dates';
import type { Cents } from './money';

// What a client owes and what arrived (spec §5.6). The status is derived, never typed in:
// open → paid / short / late → claim_ready → claimed → paid.

export type SettlementStatus = 'open' | 'paid' | 'short' | 'late' | 'claim_ready' | 'claimed';

export interface LineInput {
  expectedCents: Cents | null; // null: amount not known yet (e.g. T-Force rate not loaded)
  expectedDate: string | null;
  receivedCents: Cents; // sum of allocations
  claim: 'none' | 'ready' | 'sent';
}

/** Status, missing amount and days late for one expected line on `today`. */
export function settlementStatus(line: LineInput, today: string) {
  const missing = line.expectedCents == null ? null : Math.max(0, line.expectedCents - line.receivedCents);
  const daysLate = line.expectedDate && today > line.expectedDate ? daysBetween(line.expectedDate, today) : 0;
  let status: SettlementStatus;
  if (line.expectedCents != null && line.receivedCents >= line.expectedCents && line.expectedCents > 0) status = 'paid';
  else if (line.claim === 'sent') status = 'claimed';
  else if (line.claim === 'ready') status = 'claim_ready';
  else if (line.receivedCents > 0) status = 'short';
  else if (daysLate > 0) status = 'late';
  else status = 'open';
  return { status, missingCents: missing, daysLate };
}

export interface SummaryLine extends LineInput {
  operation: string;
  kind: string;
  paidToPayee: boolean; // the driver or contractor was already paid for this work
}

/** The four figures at the top of the Settlements screen. */
export function settlementSummary(lines: SummaryLine[], today: string, month: { start: string; end: string }, received: { date: string; amountCents: Cents }[]) {
  let expectedNotDue = 0, late = 0, lateCount = 0, unknownAmounts = 0;
  let paidNotByClient = 0, paidNotByClientCents = 0;
  for (const l of lines) {
    const s = settlementStatus(l, today);
    if (s.status === 'paid') continue;
    if (l.expectedCents == null) { unknownAmounts++; continue; }
    if (s.daysLate > 0) { late += s.missingCents ?? 0; lateCount++; } else expectedNotDue += s.missingCents ?? 0;
    if (l.paidToPayee && (s.status === 'claim_ready' || s.status === 'claimed' || s.daysLate > 0)) { paidNotByClient++; paidNotByClientCents += s.missingCents ?? 0; }
  }
  const receivedInMonth = received.filter((r) => r.date >= month.start && r.date <= month.end).reduce((s, r) => s + r.amountCents, 0);
  return { expectedNotDue, late, lateCount, unknownAmounts, paidNotByClient, paidNotByClientCents, receivedInMonth };
}

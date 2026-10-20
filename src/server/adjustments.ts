import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Tx } from '~/db/client';
import { adjustmentTypes, payAdjustments } from '~/db/schema';
import type { Actor } from './actor';
import { audit } from './audit';

// Pay adjustments (docs/db-model.md §2.6): bonuses and, later, goal top-ups, corrections and deductions.
// Hovership's bonus screen keeps one manual bonus per driver-day; standing bonuses (premise 4) will add
// rows of their own.

export const BONUS = 'bonus';

async function typeId(tx: Tx, code: string) {
  const [t] = await tx.select({ id: adjustmentTypes.id }).from(adjustmentTypes).where(eq(adjustmentTypes.code, code));
  if (!t) throw new Error(`Adjustment type "${code}" is missing`);
  return t.id;
}

/** Confirmed adjustments per execution, summed. */
export async function adjustmentsByExecution(tx: Tx, executionIds: string[]): Promise<Map<string, number>> {
  if (!executionIds.length) return new Map();
  const rows = await tx.select({ id: payAdjustments.executionId, total: sql<string>`sum(${payAdjustments.amountCents})` }).from(payAdjustments)
    .where(and(inArray(payAdjustments.executionId, executionIds), eq(payAdjustments.status, 'confirmed'))).groupBy(payAdjustments.executionId);
  return new Map(rows.map((r) => [r.id!, Number(r.total)]));
}

/**
 * Sets the manual bonus of one execution (the Hovership bonus field): inserts, changes or removes it.
 * Returns the row before and after for the caller's checks.
 */
export async function setManualBonus(tx: Tx, actor: Actor, input: { executionId: string; payeeId: string; amountCents: number; reason?: string | null }) {
  const bonusType = await typeId(tx, BONUS);
  const [before] = await tx.select().from(payAdjustments).where(and(
    eq(payAdjustments.executionId, input.executionId), eq(payAdjustments.typeId, bonusType), eq(payAdjustments.source, 'manual')));
  if ((before?.amountCents ?? 0) === input.amountCents) return { before: before ?? null, after: before ?? null };
  let after = null;
  if (!input.amountCents) {
    await tx.delete(payAdjustments).where(eq(payAdjustments.id, before!.id));
  } else if (before) {
    [after] = await tx.update(payAdjustments).set({ amountCents: input.amountCents, reason: input.reason ?? before.reason, confirmedBy: actor.userId, confirmedAt: new Date(), updatedAt: new Date() })
      .where(eq(payAdjustments.id, before.id)).returning();
  } else {
    [after] = await tx.insert(payAdjustments).values({
      payeeId: input.payeeId, executionId: input.executionId, typeId: bonusType, amountCents: input.amountCents, reason: input.reason ?? null,
      source: 'manual', status: 'confirmed', confirmedBy: actor.userId, confirmedAt: new Date(), createdBy: actor.userId,
    }).returning();
  }
  await audit(tx, { table: 'pay_adjustments', recordId: (after ?? before)!.id, action: !before ? 'insert' : after ? 'update' : 'delete', before: before ?? null, after, userId: actor.userId, source: actor.source });
  return { before: before ?? null, after: after ?? null };
}

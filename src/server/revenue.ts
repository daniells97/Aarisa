import { and, asc, eq, gte, lte, sql } from 'drizzle-orm';
import type { Tx } from '~/db/client';
import { otherRevenues, revenueTypes, zoneAliases, zones } from '~/db/schema';
import { assertCan, type Actor } from './actor';
import { audit } from './audit';
import { RuleError } from './errors';
import { refreshImportStatus } from './import-status';

// STEM and other revenue that isn't driver work (docs/db-model.md §2.6, owner decisions of Oct 18, 2026).
// The reason is matched to a zone through its aliases; what doesn't match, has no reason, or is far above
// the usual amount waits for someone to classify it. Classifying saves the alias for next time.

/** A STEM above this is flagged for review (the June 2026 file has $10–$50, plus one of $1,075). */
export const REVIEW_ABOVE_CENTS = 200_00;

export const zoneKey = (text: string) => text.trim().replace(/\s+/g, ' ').toLowerCase();

/** Alias, zone name and zone code (all lower-case) → zone id. */
export async function zoneLookup(tx: Tx): Promise<Map<string, string>> {
  const all = await tx.select().from(zones);
  const aliases = await tx.select().from(zoneAliases);
  return new Map([
    ...all.flatMap((z) => [[zoneKey(z.name), z.id], [zoneKey(z.code), z.id]] as [string, string][]),
    ...aliases.map((a) => [a.aliasText, a.zoneId] as [string, string]),
  ]);
}

async function revenueTypeId(tx: Tx, operationId: string, code: string) {
  const [t] = await tx.select({ id: revenueTypes.id }).from(revenueTypes).where(and(eq(revenueTypes.operationId, operationId), eq(revenueTypes.code, code)));
  if (!t) throw new RuleError('unknown_revenue_type');
  return t.id;
}

/** Stores one STEM-like amount from a report, classified when its zone is known and the amount is usual. */
export async function recordOtherRevenue(tx: Tx, input: {
  operationId: string; date: string; typeCode: string; executionId: string | null; reason: string | null; amountCents: number; importId: string | null;
}, lookup: Map<string, string>) {
  const zoneId = input.reason ? lookup.get(zoneKey(input.reason)) ?? null : null;
  const status = zoneId && input.amountCents <= REVIEW_ABOVE_CENTS ? 'classified' as const : 'needs_review' as const;
  const [row] = await tx.insert(otherRevenues).values({
    operationId: input.operationId, date: input.date, typeId: await revenueTypeId(tx, input.operationId, input.typeCode), executionId: input.executionId,
    zoneId, reason: input.reason?.trim() || null, amountCents: input.amountCents, status, importId: input.importId,
  }).returning();
  return row!;
}

/** Total other revenue of an operation in a date range (it counts in operation profit, never in driver pay). */
export async function otherRevenueTotal(tx: Tx, operationId: string, from: string, to: string) {
  const [row] = await tx.select({ total: sql<string>`coalesce(sum(${otherRevenues.amountCents}), 0)` }).from(otherRevenues)
    .where(and(eq(otherRevenues.operationId, operationId), gte(otherRevenues.date, from), lte(otherRevenues.date, to)));
  return Number(row?.total ?? 0);
}

/** Rows waiting for a person, with the zones they can be put under. */
export async function revenueToReview(tx: Tx, operationId: string, from: string, to: string) {
  const rows = await tx.select().from(otherRevenues).where(and(
    eq(otherRevenues.operationId, operationId), eq(otherRevenues.status, 'needs_review'), gte(otherRevenues.date, from), lte(otherRevenues.date, to)))
    .orderBy(asc(otherRevenues.date));
  return rows.map((r) => ({ id: r.id, date: r.date, reason: r.reason, amountCents: r.amountCents, zoneId: r.zoneId, unusual: r.amountCents > REVIEW_ABOVE_CENTS }));
}

export async function zoneOptions(tx: Tx) {
  return tx.select({ id: zones.id, name: zones.name }).from(zones).where(eq(zones.active, true)).orderBy(asc(zones.name));
}

export type Classification = { zoneId: string } | { newZone: string } | { lumpAdjustment: string };

/**
 * A person says what a STEM row is: a zone (the text it arrived with is remembered as that zone), a new
 * zone, or a lump adjustment with a note (it isn't one zone's STEM). Audited.
 */
export async function classifyOtherRevenue(tx: Tx, actor: Actor, id: string, c: Classification) {
  assertCan(actor, 'reports.import');
  const [before] = await tx.select().from(otherRevenues).where(eq(otherRevenues.id, id));
  if (!before) throw new RuleError('not_found');
  let values: Partial<typeof otherRevenues.$inferInsert>;
  if ('lumpAdjustment' in c) {
    const note = c.lumpAdjustment.trim();
    if (!note) throw new RuleError('note_required');
    values = { status: 'lump_adjustment', zoneId: null, reviewNote: note };
  } else {
    let zoneId: string;
    if ('newZone' in c) {
      const name = c.newZone.trim().replace(/\s+/g, ' ');
      if (!name) throw new RuleError('name_required');
      const code = zoneKey(name).replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
      const [clash] = await tx.select({ id: zones.id }).from(zones).where(eq(zones.code, code));
      if (clash) throw new RuleError('name_taken');
      const [z] = await tx.insert(zones).values({ code, name }).returning();
      await audit(tx, { table: 'zones', recordId: z!.id, action: 'insert', after: z, userId: actor.userId, source: actor.source });
      zoneId = z!.id;
    } else {
      const [z] = await tx.select({ id: zones.id }).from(zones).where(eq(zones.id, c.zoneId));
      if (!z) throw new RuleError('not_found');
      zoneId = z.id;
    }
    // Next time this text arrives it is recognised on its own.
    if (before.reason && !(await zoneLookup(tx)).has(zoneKey(before.reason))) {
      const [alias] = await tx.insert(zoneAliases).values({ zoneId, aliasText: zoneKey(before.reason) }).returning();
      await audit(tx, { table: 'zone_aliases', recordId: alias!.id, action: 'insert', after: alias, userId: actor.userId, source: actor.source });
    }
    values = { status: 'classified', zoneId, reviewNote: null };
  }
  const [after] = await tx.update(otherRevenues).set(values).where(eq(otherRevenues.id, id)).returning();
  await audit(tx, { table: 'other_revenues', recordId: id, action: 'update', before, after, userId: actor.userId, source: actor.source });
  if (before.importId) await refreshImportStatus(tx, actor, before.importId);
  return after!;
}

import { and, eq } from 'drizzle-orm';
import type { Tx } from '~/db/client';
import { exceptions, otherRevenues, reportImports } from '~/db/schema';
import type { Actor } from './actor';
import { audit } from './audit';

/**
 * A partly read import becomes done once nothing from it waits for a person: no unknown driver codes
 * left open, no unreadable lines, and no STEM still to classify.
 */
export async function refreshImportStatus(tx: Tx, actor: Actor, importId: string) {
  const [imp] = await tx.select().from(reportImports).where(eq(reportImports.id, importId));
  if (!imp || imp.status !== 'partial') return;
  const problems = (imp.problems ?? {}) as { badLines?: unknown[] };
  const open = await tx.select({ details: exceptions.details }).from(exceptions).where(and(
    eq(exceptions.operationId, imp.operationId), eq(exceptions.type, 'unknown_driver_code'), eq(exceptions.status, 'open')));
  const codesOpen = open.some((o) => (o.details as { importId?: string }).importId === importId);
  const [stem] = await tx.select({ id: otherRevenues.id }).from(otherRevenues)
    .where(and(eq(otherRevenues.importId, importId), eq(otherRevenues.status, 'needs_review'))).limit(1);
  if (codesOpen || stem || problems.badLines?.length) return;
  const [after] = await tx.update(reportImports).set({ status: 'done' }).where(eq(reportImports.id, imp.id)).returning();
  await audit(tx, { table: 'report_imports', recordId: imp.id, action: 'update', before: imp, after, userId: actor.userId, source: 'system' });
}

import { createDb, type Tx } from '~/db/client';
import type { Actor } from '~/server/actor';
import type { Role } from '~/domain/permissions';

class Rollback extends Error {}
const database = createDb();

/** Runs `fn` in a transaction that is always rolled back, so tests leave the dev database untouched. */
export async function withRollback<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  let result: T;
  try {
    await database.transaction(async (tx) => {
      result = await fn(tx);
      throw new Rollback();
    });
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  }
  return result!;
}

export const actorAs = (role: Role, userId: string | null = null): Actor => ({ userId, role, name: role, locale: 'en', source: 'portal' });
export const ALL_ROLES: Role[] = ['owner', 'dispatcher', 'finance', 'viewer'];

import { readFileSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import { exceptions, operationRevenue, operations, payPeriods, payrollLines, payrollRuns, reportImports, workRecords } from '~/db/schema';

export const HOVERSHIP_CSV = readFileSync(new URL('../../docs/seed/hovership_details_jun2026.csv', import.meta.url), 'utf8');

/** Inside a rolled-back test transaction: start from an empty Hovership operation even if the dev seed loaded data. */
export async function clearHovership(tx: Tx) {
  const [op] = await tx.select().from(operations).where(eq(operations.code, 'hovership'));
  const periods = await tx.select({ id: payPeriods.id }).from(payPeriods).where(eq(payPeriods.operationId, op!.id));
  for (const p of periods) {
    const runs = await tx.select({ id: payrollRuns.id }).from(payrollRuns).where(eq(payrollRuns.payPeriodId, p.id));
    for (const r of runs) await tx.delete(payrollLines).where(eq(payrollLines.runId, r.id));
    await tx.delete(payrollRuns).where(eq(payrollRuns.payPeriodId, p.id));
  }
  await tx.delete(payPeriods).where(eq(payPeriods.operationId, op!.id));
  await tx.delete(exceptions).where(eq(exceptions.operationId, op!.id));
  await tx.delete(workRecords).where(eq(workRecords.operationId, op!.id));
  await tx.delete(operationRevenue).where(eq(operationRevenue.operationId, op!.id));
  await tx.delete(reportImports).where(eq(reportImports.operationId, op!.id));
  return op!;
}

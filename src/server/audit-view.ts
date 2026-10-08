import { and, desc, eq, lt } from 'drizzle-orm';
import type { Tx } from '~/db/client';
import { auditLog, users } from '~/db/schema';
import { assertCan, type Actor } from './actor';

const IGNORED = new Set(['updatedAt', 'createdAt']);

/** Field names whose value differs between before and after. */
export function changedFields(before: unknown, after: unknown): string[] {
  const b = (before ?? {}) as Record<string, unknown>;
  const a = (after ?? {}) as Record<string, unknown>;
  const keys = new Set([...Object.keys(b), ...Object.keys(a)]);
  return [...keys].filter((k) => !IGNORED.has(k) && JSON.stringify(b[k]) !== JSON.stringify(a[k])).sort();
}

export const AUDIT_TABLES = ['work_records', 'rates', 'drivers', 'contractors', 'report_imports', 'operation_revenue', 'exceptions', 'payroll_runs', 'payroll_lines', 'pay_periods', 'users', 'operations', 'service_types'] as const;

export async function listAudit(tx: Tx, actor: Actor, opts: { table?: string; before?: string; limit?: number }) {
  assertCan(actor, 'audit.view');
  const limit = Math.min(opts.limit ?? 100, 200);
  const where = and(
    opts.table ? eq(auditLog.tableName, opts.table) : undefined,
    opts.before ? lt(auditLog.at, new Date(opts.before)) : undefined,
  );
  const rows = await tx.select({ log: auditLog, user: users.name }).from(auditLog).leftJoin(users, eq(users.id, auditLog.userId))
    .where(where).orderBy(desc(auditLog.at), desc(auditLog.id)).limit(limit + 1);
  const page = rows.slice(0, limit);
  return {
    entries: page.map(({ log, user }) => ({
      id: log.id, at: log.at.toISOString(), table: log.tableName, recordId: log.recordId, action: log.action,
      source: log.source, user: user ?? null, fields: log.action === 'update' ? changedFields(log.before, log.after) : [],
    })),
    nextBefore: rows.length > limit ? page.at(-1)!.log.at.toISOString() : null,
  };
}

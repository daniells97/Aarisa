import { auditLog } from '~/db/schema';
import type { Tx } from '~/db/client';

export type AuditSource = 'portal' | 'whatsapp' | 'email-import' | 'system';
export type AuditAction = 'insert' | 'update' | 'delete' | 'approve' | 'reopen' | 'undo' | 'import';

export interface AuditEntry {
  table: string;
  recordId: string;
  action: AuditAction;
  before?: unknown;
  after?: unknown;
  userId?: string | null;
  source: AuditSource;
}

/** Writes audit rows in the caller's transaction so the change and its trail commit together. */
export async function audit(tx: Tx, entries: AuditEntry | AuditEntry[]) {
  const list = Array.isArray(entries) ? entries : [entries];
  if (list.length === 0) return;
  await tx.insert(auditLog).values(
    list.map((e) => ({
      tableName: e.table,
      recordId: e.recordId,
      action: e.action,
      before: e.before ?? null,
      after: e.after ?? null,
      userId: e.userId ?? null,
      source: e.source,
    })),
  );
}

import { db, type Tx } from '~/db/client';
import type { Permission } from '~/domain/permissions';
import { requireActor } from './auth';
import type { Actor } from './actor';
import { RuleError } from './errors';

export type Result<T> = { ok: true; value: T } | { ok: false; code: string };

/**
 * Body of every server function: checks the permission on the server, runs in one
 * transaction (so audit rows commit with the change) and turns rule errors into codes.
 */
export async function run<T>(permission: Permission, fn: (tx: Tx, actor: Actor) => Promise<T>): Promise<Result<T>> {
  const actor = await requireActor(permission);
  try {
    return { ok: true, value: await db().transaction((tx) => fn(tx, actor)) };
  } catch (e) {
    if (e instanceof RuleError) return { ok: false, code: e.code };
    throw e;
  }
}

/** Read-only variant that returns the value directly. */
export async function read<T>(permission: Permission, fn: (tx: Tx, actor: Actor) => Promise<T>): Promise<T> {
  const actor = await requireActor(permission);
  return db().transaction((tx) => fn(tx, actor));
}

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

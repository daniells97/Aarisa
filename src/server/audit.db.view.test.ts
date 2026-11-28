import { describe, expect, it } from 'vitest';
import { actorAs, withRollback } from '../../tests/helpers/db';
import { ForbiddenError } from './actor';
import { listAudit } from './audit-view';

describe('audit view (server)', () => {
  it('is readable by owner, finance and viewer but not dispatchers', () =>
    withRollback(async (tx) => {
      for (const role of ['owner', 'finance', 'viewer'] as const) await expect(listAudit(tx, actorAs(role), { limit: 5 })).resolves.toBeTruthy();
      await expect(listAudit(tx, actorAs('dispatcher'), {})).rejects.toBeInstanceOf(ForbiddenError);
    }));
});

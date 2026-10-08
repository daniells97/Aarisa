import { describe, expect, it } from 'vitest';
import { users } from '~/db/schema';
import { ALL_ROLES, actorAs, withRollback } from '../../tests/helpers/db';
import { ForbiddenError } from './actor';
import { listTeam, recordRoleChange, updateTeamMember } from './team';

async function makeUsers(tx: Parameters<Parameters<typeof withRollback>[0]>[0]) {
  const [owner] = await tx.insert(users).values({ zitadelSub: 'test:owner', name: 'T Owner', email: 'o@test', role: 'owner' }).returning();
  const [disp] = await tx.insert(users).values({ zitadelSub: 'test:disp', name: 'T Disp', email: 'd@test', role: 'dispatcher' }).returning();
  return { owner: owner!, disp: disp! };
}

describe('team access (server)', () => {
  for (const role of ALL_ROLES.filter((r) => r !== 'owner')) {
    it(`${role} cannot list or change the team`, () =>
      withRollback(async (tx) => {
        const { disp } = await makeUsers(tx);
        await expect(listTeam(tx, actorAs(role))).rejects.toBeInstanceOf(ForbiddenError);
        await expect(updateTeamMember(tx, actorAs(role), disp.id, { phone: null, morningChannel: 'none', locale: 'en', active: false }))
          .rejects.toBeInstanceOf(ForbiddenError);
        await expect(recordRoleChange(tx, actorAs(role), disp.id, 'owner')).rejects.toBeInstanceOf(ForbiddenError);
      }));
  }

  it('owner pauses a dispatcher, needs a phone for WhatsApp and cannot pause or demote themself', () =>
    withRollback(async (tx) => {
      const { owner, disp } = await makeUsers(tx);
      const me = actorAs('owner', owner.id);
      expect((await listTeam(tx, me)).find((u) => u.id === owner.id)!.isSelf).toBe(true);
      await expect(updateTeamMember(tx, me, disp.id, { phone: null, morningChannel: 'whatsapp', locale: 'es', active: true }))
        .rejects.toMatchObject({ code: 'phone_required_for_whatsapp' });
      const updated = await updateTeamMember(tx, me, disp.id, { phone: '+1 (925) 555-0101', morningChannel: 'whatsapp', locale: 'es', active: false });
      expect(updated).toMatchObject({ phone: '+19255550101', active: false });
      await expect(updateTeamMember(tx, me, owner.id, { phone: null, morningChannel: 'none', locale: 'en', active: false }))
        .rejects.toMatchObject({ code: 'cannot_pause_self' });
      await expect(recordRoleChange(tx, me, owner.id, 'viewer')).rejects.toMatchObject({ code: 'cannot_demote_self' });
    }));
});

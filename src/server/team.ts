import { asc, eq } from 'drizzle-orm';
import type { Tx } from '~/db/client';
import { users } from '~/db/schema';
import type { Role } from '~/domain/permissions';
import { assertCan, type Actor } from './actor';
import { audit } from './audit';
import { RuleError } from './errors';

// Team access (spec 6.11). Owner only. Role and invites live in Zitadel; the portal keeps
// phone, morning channel, language and an on/off switch that blocks sign-in immediately.

export async function listTeam(tx: Tx, actor: Actor) {
  assertCan(actor, 'team.manage');
  const rows = await tx.select().from(users).orderBy(asc(users.name));
  return rows.map((u) => ({
    id: u.id, name: u.name, email: u.email, phone: u.phone, role: u.role as Role,
    morningChannel: u.morningChannel, locale: u.locale, active: u.active, zitadelSub: u.zitadelSub,
    isSelf: u.id === actor.userId,
  }));
}

export interface TeamMemberInput {
  phone: string | null;
  morningChannel: 'whatsapp' | 'email' | 'none';
  locale: 'en' | 'es';
  active: boolean;
}

export async function updateTeamMember(tx: Tx, actor: Actor, id: string, input: TeamMemberInput) {
  assertCan(actor, 'team.manage');
  const [before] = await tx.select().from(users).where(eq(users.id, id));
  if (!before) throw new RuleError('not_found');
  if (id === actor.userId && !input.active) throw new RuleError('cannot_pause_self');
  const phone = input.phone?.replace(/[^\d+]/g, '') || null;
  if (input.morningChannel === 'whatsapp' && !phone) throw new RuleError('phone_required_for_whatsapp');
  const [after] = await tx.update(users).set({ ...input, phone, updatedAt: new Date() }).where(eq(users.id, id)).returning();
  await audit(tx, { table: 'users', recordId: id, action: 'update', before, after, userId: actor.userId, source: actor.source });
  return after!;
}

/** Mirrors a role change made in Zitadel so it applies before the person signs in again. */
export async function recordRoleChange(tx: Tx, actor: Actor, id: string, role: Role) {
  assertCan(actor, 'team.manage');
  const [before] = await tx.select().from(users).where(eq(users.id, id));
  if (!before) throw new RuleError('not_found');
  if (id === actor.userId && role !== 'owner') throw new RuleError('cannot_demote_self');
  const [after] = await tx.update(users).set({ role, updatedAt: new Date() }).where(eq(users.id, id)).returning();
  await audit(tx, { table: 'users', recordId: id, action: 'update', before, after, userId: actor.userId, source: actor.source });
  return after!;
}

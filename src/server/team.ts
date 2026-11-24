import { asc, eq, sql } from 'drizzle-orm';
import type { Tx } from '~/db/client';
import { users } from '~/db/schema';
import type { Role } from '~/domain/permissions';
import { assertCan, type Actor } from './actor';
import { audit } from './audit';
import { RuleError } from './errors';
import { whatsappEnabled } from './features';

// Team access (spec 6.11). Owner only. Role and invites live in Zitadel; the portal keeps
// phone, morning channel, language and an on/off switch that blocks sign-in immediately.

export async function listTeam(tx: Tx, actor: Actor) {
  assertCan(actor, 'team.manage');
  const rows = await tx.select().from(users).orderBy(asc(users.name));
  return rows.map((u) => ({
    id: u.id, name: u.name, email: u.email, phone: u.phone, role: u.role as Role,
    morningChannel: u.morningChannel, locale: u.locale, active: u.active, zitadelSub: u.zitadelSub, canRecordLoans: u.canRecordLoans,
    invited: !u.firstSignInAt,
    isSelf: u.id === actor.userId,
  }));
}

export interface TeamMemberInput {
  phone: string | null;
  morningChannel: 'whatsapp' | 'email' | 'none';
  locale: 'en' | 'es';
  active: boolean;
  /** Lets this person record loans and salary advances. Ignored for the owner (always can). */
  canRecordLoans?: boolean;
}

export async function updateTeamMember(tx: Tx, actor: Actor, id: string, input: TeamMemberInput) {
  assertCan(actor, 'team.manage');
  const [before] = await tx.select().from(users).where(eq(users.id, id));
  if (!before) throw new RuleError('not_found');
  if (id === actor.userId && !input.active) throw new RuleError('cannot_pause_self');
  const phone = input.phone?.replace(/[^\d+]/g, '') || null;
  // Someone already on WhatsApp keeps it while it's off; nobody new can choose it.
  if (input.morningChannel === 'whatsapp' && !whatsappEnabled() && before.morningChannel !== 'whatsapp') throw new RuleError('whatsapp_unavailable');
  if (input.morningChannel === 'whatsapp' && !phone) throw new RuleError('phone_required_for_whatsapp');
  const canLend = before.role === 'viewer' ? false : input.canRecordLoans ?? before.canRecordLoans;
  const [after] = await tx.update(users).set({ ...input, canRecordLoans: canLend, phone, updatedAt: new Date() }).where(eq(users.id, id)).returning();
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

/**
 * An invite puts the person in Team access right away (as invited) instead of only after their first
 * sign-in. Their sign-in account id is the key; inviting again updates the name and role.
 */
export async function recordInvite(tx: Tx, actor: Actor, p: { sub: string; email: string; givenName: string; familyName: string; role: Role; locale: 'en' | 'es' }) {
  assertCan(actor, 'team.manage');
  const name = `${p.givenName} ${p.familyName}`.trim();
  const email = p.email.trim().toLowerCase();
  const [bySub] = await tx.select().from(users).where(eq(users.zitadelSub, p.sub));
  const [byEmail] = bySub ? [bySub] : await tx.select().from(users).where(eq(sql`lower(${users.email})`, email));
  const before = bySub ?? byEmail;
  if (before) {
    if (before.firstSignInAt) return before; // already using the portal: role changes go through Change role
    const [after] = await tx.update(users).set({ zitadelSub: p.sub, name, email, role: p.role, locale: p.locale, updatedAt: new Date() }).where(eq(users.id, before.id)).returning();
    await audit(tx, { table: 'users', recordId: before.id, action: 'update', before, after, userId: actor.userId, source: actor.source });
    return after!;
  }
  const [row] = await tx.insert(users).values({ zitadelSub: p.sub, name, email, role: p.role, locale: p.locale }).returning();
  await audit(tx, { table: 'users', recordId: row!.id, action: 'insert', after: row, userId: actor.userId, source: actor.source });
  return row!;
}

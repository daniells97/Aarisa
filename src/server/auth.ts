import { eq } from 'drizzle-orm';
import { getCookie } from '@tanstack/react-start/server';
import { db } from '~/db/client';
import { users } from '~/db/schema';
import { isRole, type Permission } from '~/domain/permissions';
import { isLocale } from '~/i18n';
import { assertCan, type Actor } from './actor';
import { SESSION_COOKIE, unseal, type SessionPayload } from './session';

/** Current signed-in actor, re-read from the database on every request so role changes apply at once. */
export async function currentActor(): Promise<Actor | null> {
  const session = unseal<SessionPayload>(getCookie(SESSION_COOKIE));
  if (!session) return null;
  const [user] = await db().select().from(users).where(eq(users.id, session.uid));
  if (!user || !user.active || !isRole(user.role)) return null;
  return { userId: user.id, role: user.role, name: user.name, locale: isLocale(user.locale) ? user.locale : 'en', source: 'portal' };
}

/** For server functions: returns the actor or throws 401/403. */
export async function requireActor(permission: Permission): Promise<Actor> {
  const actor = await currentActor();
  assertCan(actor, permission);
  return actor;
}

export async function requireSignedIn(): Promise<Actor> {
  return requireActor('payroll.view'); // every role has it
}

export function devLoginEnabled() {
  return process.env.NODE_ENV !== 'production' && process.env.DEV_LOGIN === '1';
}

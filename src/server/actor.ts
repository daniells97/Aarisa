import { can, type Permission, type Role } from '~/domain/permissions';
import type { Locale } from '~/i18n';

/** The person (or system) performing a server action. Every write takes one. */
export interface Actor {
  userId: string | null;
  role: Role;
  name: string;
  locale: Locale;
  source: 'portal' | 'whatsapp' | 'email-import' | 'system';
}

export class ForbiddenError extends Error {
  readonly status = 403;
  constructor(readonly permission: Permission) {
    super(`Not allowed: ${permission}`);
  }
}

export class UnauthorizedError extends Error {
  readonly status = 401;
  constructor() { super('Sign in required'); }
}

export function assertCan(actor: Actor | null, permission: Permission): asserts actor is Actor {
  if (!actor) throw new UnauthorizedError();
  if (!can(actor.role, permission)) throw new ForbiddenError(permission);
}

export const SYSTEM_ACTOR: Actor = { userId: null, role: 'owner', name: 'System', locale: 'en', source: 'system' };

import { createServerFn } from '@tanstack/react-start';
import { getCookie, getRequestHeader, setCookie } from '@tanstack/react-start/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '~/db/client';
import { users } from '~/db/schema';
import { isLocale, localeFromHeader, type Locale } from '~/i18n';
import type { Role } from '~/domain/permissions';
import { audit } from './audit';
import { currentActor, devLoginEnabled } from './auth';

export const LANG_COOKIE = 'aarisa_lang';

export interface SessionInfo {
  user: { name: string; role: Role } | null;
  locale: Locale;
  devLogin: boolean;
}

export const getSession = createServerFn({ method: 'GET' }).handler(async (): Promise<SessionInfo> => {
  const actor = await currentActor();
  const cookieLang = getCookie(LANG_COOKIE);
  const locale = actor?.locale ?? (isLocale(cookieLang) ? cookieLang : localeFromHeader(getRequestHeader('accept-language')));
  return { user: actor ? { name: actor.name, role: actor.role } : null, locale, devLogin: devLoginEnabled() };
});

/** Changes the interface language; saved on the user when signed in. */
export const setLocale = createServerFn({ method: 'POST' })
  .validator(z.object({ locale: z.enum(['en', 'es']) }))
  .handler(async ({ data }) => {
    setCookie(LANG_COOKIE, data.locale, { path: '/', maxAge: 60 * 60 * 24 * 365, sameSite: 'lax' });
    const actor = await currentActor();
    if (actor?.userId) {
      await db().transaction(async (tx) => {
        const [before] = await tx.select().from(users).where(eq(users.id, actor.userId!));
        const [after] = await tx.update(users).set({ locale: data.locale, updatedAt: new Date() }).where(eq(users.id, actor.userId!)).returning();
        await audit(tx, { table: 'users', recordId: actor.userId!, action: 'update', before, after, userId: actor.userId, source: 'portal' });
      });
    }
    return { ok: true };
  });

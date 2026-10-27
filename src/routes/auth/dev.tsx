import { createFileRoute } from '@tanstack/react-router';
import { eq } from 'drizzle-orm';
import { setCookie } from '@tanstack/react-start/server';
import { db } from '~/db/client';
import { users } from '~/db/schema';
import { audit } from '~/server/audit';
import { isRole } from '~/domain/permissions';
import { devLoginEnabled } from '~/server/auth';
import { publicUrl, safeReturnTo } from '~/server/oidc';
import { SESSION_COOKIE, SESSION_TTL, cookieOptions, seal } from '~/server/session';
import { upsertUserFromIdentity } from '~/server/users';

// Development only (NODE_ENV != production and DEV_LOGIN=1): sign in as a fake user of a given role.
const names = { owner: 'Aaron Fitzpatrick', dispatcher: 'Dev dispatcher', finance: 'Dev finance', viewer: 'Dev viewer' } as const;

export const Route = createFileRoute('/auth/dev')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const role = url.searchParams.get('role');
        if (!devLoginEnabled() || !isRole(role)) return new Response('Not found', { status: 404 });
        const lang = url.searchParams.get('lang');
        const user = await db().transaction(async (tx) => {
          const u = await upsertUserFromIdentity(tx, { sub: `dev:${role}`, name: names[role], email: `${role}@dev.aarisa.local`, role, locale: lang ?? 'en' });
          if ((lang !== 'en' && lang !== 'es') || u.locale === lang) return u;
          const [after] = await tx.update(users).set({ locale: lang, updatedAt: new Date() }).where(eq(users.id, u.id)).returning();
          await audit(tx, { table: 'users', recordId: u.id, action: 'update', before: u, after, userId: u.id, source: 'portal' });
          return after!;
        });
        setCookie(SESSION_COOKIE, seal({ uid: user.id }, SESSION_TTL), cookieOptions(SESSION_TTL));
        return new Response(null, { status: 302, headers: { location: publicUrl(safeReturnTo(url.searchParams.get('returnTo')), url.toString()) } });
      },
    },
  },
});

import { createFileRoute } from '@tanstack/react-router';
import { setCookie } from '@tanstack/react-start/server';
import { db } from '~/db/client';
import { isRole } from '~/domain/permissions';
import { devLoginEnabled } from '~/server/auth';
import { safeReturnTo, } from '~/server/oidc';
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
        const user = await db().transaction((tx) => upsertUserFromIdentity(tx, {
          sub: `dev:${role}`, name: names[role], email: `${role}@dev.aarisa.local`, role, locale: url.searchParams.get('lang') ?? 'en',
        }));
        setCookie(SESSION_COOKIE, seal({ uid: user.id }, SESSION_TTL), cookieOptions(SESSION_TTL));
        return new Response(null, { status: 302, headers: { location: new URL(safeReturnTo(url.searchParams.get('returnTo')), url).toString() } });
      },
    },
  },
});

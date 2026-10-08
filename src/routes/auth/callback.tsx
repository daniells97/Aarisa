import { createFileRoute } from '@tanstack/react-router';
import { deleteCookie, getCookie, setCookie } from '@tanstack/react-start/server';
import { db } from '~/db/client';
import { exchangeCode, fetchUserInfo, oidcConfig, roleFromClaims } from '~/server/oidc';
import { LOGIN_COOKIE, SESSION_COOKIE, SESSION_TTL, cookieOptions, seal, unseal, type LoginPayload } from '~/server/session';
import { upsertUserFromIdentity } from '~/server/users';

const fail = (url: URL, error: string) => new Response(null, { status: 302, headers: { location: new URL(`/login?error=${error}`, url).toString() } });

export const Route = createFileRoute('/auth/callback')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const cfg = oidcConfig();
        const login = unseal<LoginPayload>(getCookie(LOGIN_COOKIE));
        deleteCookie(LOGIN_COOKIE, { path: '/' });
        const code = url.searchParams.get('code');
        if (!cfg || !login || !code || url.searchParams.get('state') !== login.state) return fail(url, 'state');
        try {
          const tokens = await exchangeCode(cfg, code, login.verifier);
          const info = await fetchUserInfo(cfg, tokens.access_token);
          const role = roleFromClaims(info);
          if (!role) return fail(url, 'no_role');
          const user = await db().transaction((tx) => upsertUserFromIdentity(tx, {
            sub: info.sub, name: info.name ?? info.email ?? info.sub, email: info.email ?? `${info.sub}@zitadel`, role, locale: info.locale,
          }));
          if (!user.active) return fail(url, 'inactive');
          setCookie(SESSION_COOKIE, seal({ uid: user.id }, SESSION_TTL), cookieOptions(SESSION_TTL));
          return new Response(null, { status: 302, headers: { location: new URL(login.returnTo, url).toString() } });
        } catch (e) {
          console.error('OIDC callback failed', e);
          return fail(url, 'provider');
        }
      },
    },
  },
});

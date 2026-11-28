import { createFileRoute } from '@tanstack/react-router';
import { deleteCookie, getCookie } from '@tanstack/react-start/server';
import { eq } from 'drizzle-orm';
import { db } from '~/db/client';
import { users } from '~/db/schema';
import { discover, oidcConfig, publicUrl, toPublicLogin } from '~/server/oidc';
import { SESSION_COOKIE, unseal, type SessionPayload } from '~/server/session';

/**
 * Sign out of the portal and of the sign-in pages. The sign-in pages keep their session under Aarisa's
 * address (auth.aarisaconsulting.com), so the sign-out page is shown there too, and it is told which account
 * (logout_hint = the person's email) so it signs that one out and comes back, instead of asking which account.
 */
export const Route = createFileRoute('/auth/logout')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const session = unseal<SessionPayload>(getCookie(SESSION_COOKIE));
        deleteCookie(SESSION_COOKIE, { path: '/' });
        const url = new URL(request.url);
        const cfg = oidcConfig();
        let location = publicUrl('/login', url.toString());
        if (cfg) {
          const doc = await discover(cfg).catch(() => null);
          if (doc?.end_session_endpoint) {
            const end = new URL(doc.end_session_endpoint);
            end.searchParams.set('client_id', cfg.clientId);
            end.searchParams.set('post_logout_redirect_uri', new URL('/login', cfg.redirectUri).toString());
            const [user] = session ? await db().select({ email: users.email }).from(users).where(eq(users.id, session.uid)) : [];
            if (user?.email) end.searchParams.set('logout_hint', user.email);
            location = end.toString();
            try {
              const res = await fetch(end, { redirect: 'manual' });
              const next = res.headers.get('location');
              if (res.status >= 300 && res.status < 400 && next) location = toPublicLogin(new URL(next, cfg.issuer).toString(), cfg.issuer);
            } catch { /* keep the usual redirect */ }
          }
        }
        return new Response(null, { status: 302, headers: { location } });
      },
    },
  },
});

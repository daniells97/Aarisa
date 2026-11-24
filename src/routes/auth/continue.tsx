import { createFileRoute } from '@tanstack/react-router';
import { setCookie } from '@tanstack/react-start/server';
import { authorizeUrl, discover, oidcConfig, publicUrl, randomToken } from '~/server/oidc';
import { LOGIN_COOKIE, cookieOptions, seal } from '~/server/session';
import { localeFromHeader } from '~/i18n';
import { withLoginRequest } from '~/server/invite-link';

/**
 * Invite and password-reset links go through here. Without a login request, the sign-in pages end on a
 * "Welcome" page after the password is set and stay there. This starts a normal portal login first and
 * hands its request to the set-password page, so the person lands in the portal, signed in.
 */
export const Route = createFileRoute('/auth/continue')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const base = process.env.APP_BASE_URL ? new URL(process.env.APP_BASE_URL) : null;
        const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? url.host;
        if (base && host !== base.host) return new Response(null, { status: 302, headers: { location: publicUrl(url.pathname + url.search, url.toString()) } });
        const cfg = oidcConfig();
        const to = url.searchParams.get('to') ?? '';
        // Only the sign-in pages of our own issuer, never anywhere else.
        if (!cfg || !to.startsWith(`${cfg.issuer}/ui/v2/login/`)) return new Response(null, { status: 302, headers: { location: publicUrl('/login', url.toString()) } });
        try {
          const doc = await discover(cfg);
          const login = { state: randomToken(), nonce: randomToken(), verifier: randomToken(48), returnTo: '/' };
          const locale = localeFromHeader(request.headers.get('accept-language'));
          const res = await fetch(authorizeUrl(doc.authorization_endpoint, cfg, { ...login, locale }), { redirect: 'manual' });
          const location = withLoginRequest(to, res.headers.get('location'));
          if (location !== to) setCookie(LOGIN_COOKIE, seal(login, 1800), cookieOptions(1800));
          return new Response(null, { status: 302, headers: { location } });
        } catch {
          return new Response(null, { status: 302, headers: { location: to } }); // still lets them set the password
        }
      },
    },
  },
});

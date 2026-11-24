import { createFileRoute } from '@tanstack/react-router';
import { setCookie } from '@tanstack/react-start/server';
import { authorizeUrl, discover, oidcConfig, publicUrl, randomToken, safeReturnTo, toPublicLogin } from '~/server/oidc';
import { LOGIN_COOKIE, cookieOptions, seal } from '~/server/session';
import { localeFromHeader } from '~/i18n';

export const Route = createFileRoute('/auth/login')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        // Zitadel sends people back to APP_BASE_URL only: start there, so the login cookie is on that host too.
        const base = process.env.APP_BASE_URL ? new URL(process.env.APP_BASE_URL) : null;
        const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? url.host;
        if (base && host !== base.host) return new Response(null, { status: 302, headers: { location: publicUrl(url.pathname + url.search, url.toString()) } });
        const cfg = oidcConfig();
        if (!cfg) return new Response(null, { status: 302, headers: { location: publicUrl('/login?error=not_configured', url.toString()) } });
        const doc = await discover(cfg);
        const login = { state: randomToken(), nonce: randomToken(), verifier: randomToken(48), returnTo: safeReturnTo(url.searchParams.get('returnTo')) };
        setCookie(LOGIN_COOKIE, seal(login, 600), cookieOptions(600));
        const locale = localeFromHeader(request.headers.get('accept-language'));
        const authorize = authorizeUrl(doc.authorization_endpoint, cfg, { ...login, locale });
        // The shared service always sends people to its own address for the sign-in pages; ask it here and
        // send the browser to the same page under Aarisa's address instead. Falls back to the usual redirect.
        let location = authorize;
        try {
          const res = await fetch(authorize, { redirect: 'manual' });
          const next = res.headers.get('location');
          if (res.status >= 300 && res.status < 400 && next) location = toPublicLogin(new URL(next, cfg.issuer).toString(), cfg.issuer);
        } catch { /* keep the usual redirect */ }
        return new Response(null, { status: 302, headers: { location } });
      },
    },
  },
});

import { createFileRoute } from '@tanstack/react-router';
import { setCookie } from '@tanstack/react-start/server';
import { authorizeUrl, discover, oidcConfig, publicUrl, randomToken, safeReturnTo } from '~/server/oidc';
import { LOGIN_COOKIE, cookieOptions, seal } from '~/server/session';
import { localeFromHeader } from '~/i18n';

export const Route = createFileRoute('/auth/login')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const cfg = oidcConfig();
        if (!cfg) return new Response(null, { status: 302, headers: { location: publicUrl('/login?error=not_configured', url.toString()) } });
        const doc = await discover(cfg);
        const login = { state: randomToken(), nonce: randomToken(), verifier: randomToken(48), returnTo: safeReturnTo(url.searchParams.get('returnTo')) };
        setCookie(LOGIN_COOKIE, seal(login, 600), cookieOptions(600));
        const locale = localeFromHeader(request.headers.get('accept-language'));
        return new Response(null, { status: 302, headers: { location: authorizeUrl(doc.authorization_endpoint, cfg, { ...login, locale }) } });
      },
    },
  },
});

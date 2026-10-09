import { createFileRoute } from '@tanstack/react-router';
import { deleteCookie } from '@tanstack/react-start/server';
import { discover, oidcConfig, publicUrl } from '~/server/oidc';
import { SESSION_COOKIE } from '~/server/session';

export const Route = createFileRoute('/auth/logout')({
  server: {
    handlers: {
      GET: async ({ request }) => {
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
            location = end.toString();
          }
        }
        return new Response(null, { status: 302, headers: { location } });
      },
    },
  },
});

/// <reference types="vite/client" />
import { useEffect, type ReactNode } from 'react';
import { HeadContent, Outlet, Scripts, createRootRoute } from '@tanstack/react-router';
import appCss from '~/styles/app.css?url';
import { I18nProvider, type Locale } from '~/i18n';
import { getSession } from '~/server/session-fns';
import { ToastProvider } from '~/ui';

export const Route = createRootRoute({
  beforeLoad: async () => ({ session: await getSession() }),
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' },
      { name: 'theme-color', content: '#122A5A' },
      { title: 'Aarisa Consulting' },
    ],
    links: [
      { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
      { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossOrigin: 'anonymous' },
      { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600&family=Barlow+Condensed:wght@500;600;700&display=swap' },
      { rel: 'stylesheet', href: appCss },
      { rel: 'icon', type: 'image/png', sizes: '32x32', href: '/brand/favicon-32.png' },
      { rel: 'icon', type: 'image/png', sizes: '48x48', href: '/brand/favicon-48.png' },
      { rel: 'apple-touch-icon', sizes: '180x180', href: '/brand/apple-touch-icon.png' },
    ],
  }),
  component: RootComponent,
});

function RootComponent() {
  const { session } = Route.useRouteContext();
  return (
    <RootDocument locale={session.locale}>
      <Outlet />
    </RootDocument>
  );
}

function RootDocument({ children, locale }: { children: ReactNode; locale: Locale }) {
  // Lets end-to-end tests wait until React has hydrated before clicking.
  useEffect(() => { document.documentElement.dataset.hydrated = 'true'; }, []);
  return (
    <html lang={locale}>
      <head>
        <HeadContent />
      </head>
      <body>
        <I18nProvider locale={locale}>
          <ToastProvider>{children}</ToastProvider>
        </I18nProvider>
        <Scripts />
      </body>
    </html>
  );
}

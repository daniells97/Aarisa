import { Outlet, createFileRoute, redirect } from '@tanstack/react-router';
import { AppShell } from '~/ui';
import { PageError } from '~/ui/PageError';

export const Route = createFileRoute('/_app')({
  beforeLoad: ({ context, location }) => {
    const user = context.session.user;
    if (!user) throw redirect({ to: '/login', search: { returnTo: location.href } });
    return { user };
  },
  component: AppLayout,
  errorComponent: AppError,
});

function AppLayout() {
  const { user } = Route.useRouteContext();
  return (
    <AppShell user={user}>
      <Outlet />
    </AppShell>
  );
}

function AppError({ error }: { error: unknown }) {
  const { user } = Route.useRouteContext();
  return (
    <AppShell user={user}>
      <PageError error={error} />
    </AppShell>
  );
}

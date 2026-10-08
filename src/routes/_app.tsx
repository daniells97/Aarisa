import { Outlet, createFileRoute, redirect } from '@tanstack/react-router';
import { AppShell } from '~/ui';

export const Route = createFileRoute('/_app')({
  beforeLoad: ({ context, location }) => {
    const user = context.session.user;
    if (!user) throw redirect({ to: '/login', search: { returnTo: location.href } });
    return { user };
  },
  component: AppLayout,
});

function AppLayout() {
  const { user } = Route.useRouteContext();
  return (
    <AppShell user={user}>
      <Outlet />
    </AppShell>
  );
}

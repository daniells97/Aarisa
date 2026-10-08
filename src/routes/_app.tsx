import { Outlet, createFileRoute } from '@tanstack/react-router';
import { AppShell, type ShellUser } from '~/ui';

export const Route = createFileRoute('/_app')({ component: AppLayout });

function AppLayout() {
  // Replaced by the signed-in user in step 3.
  const user: ShellUser = { name: 'Aaron Fitzpatrick', role: 'owner' };
  return (
    <AppShell user={user}>
      <Outlet />
    </AppShell>
  );
}

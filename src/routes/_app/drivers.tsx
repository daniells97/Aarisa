import { createFileRoute, redirect } from '@tanstack/react-router';

// Spec 6.10 lists /drivers and /services; both live as tabs of Drivers and rates.
export const Route = createFileRoute('/_app/drivers')({
  beforeLoad: () => { throw redirect({ to: '/settings/rates', search: { tab: 'drivers' } }); },
});

import { createFileRoute } from '@tanstack/react-router';
import { ComingLater } from '~/ui/ComingLater';

export const Route = createFileRoute('/_app/settings/rates')({ component: () => <ComingLater title="nav.driversRates" /> });

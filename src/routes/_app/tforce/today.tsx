import { createFileRoute } from '@tanstack/react-router';
import { ComingLater } from '~/ui/ComingLater';

export const Route = createFileRoute('/_app/tforce/today')({ component: () => <ComingLater title="nav.todayDrivers" /> });

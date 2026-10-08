import { createFileRoute } from '@tanstack/react-router';
import { ComingLater } from '~/ui/ComingLater';

export const Route = createFileRoute('/_app/hovership')({ component: () => <ComingLater title="nav.weeklyReport" /> });

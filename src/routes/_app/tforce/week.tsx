import { createFileRoute } from '@tanstack/react-router';
import { ComingLater } from '~/ui/ComingLater';

export const Route = createFileRoute('/_app/tforce/week')({ component: () => <ComingLater title="nav.weeklyCheck" /> });

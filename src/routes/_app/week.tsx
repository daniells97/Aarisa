import { createFileRoute } from '@tanstack/react-router';
import { ComingLater } from '~/ui/ComingLater';

export const Route = createFileRoute('/_app/week')({ component: () => <ComingLater title="tab.week" /> });

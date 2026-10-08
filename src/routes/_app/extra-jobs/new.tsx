import { createFileRoute } from '@tanstack/react-router';
import { ComingLater } from '~/ui/ComingLater';

export const Route = createFileRoute('/_app/extra-jobs/new')({ component: () => <ComingLater title="tab.extraJobs" /> });

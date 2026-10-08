import { createFileRoute } from '@tanstack/react-router';
import { ComingLater } from '~/ui/ComingLater';

export const Route = createFileRoute('/_app/settlements')({ component: () => <ComingLater title="nav.settlements" /> });

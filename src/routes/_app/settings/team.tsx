import { createFileRoute } from '@tanstack/react-router';
import { ComingLater } from '~/ui/ComingLater';

export const Route = createFileRoute('/_app/settings/team')({ component: () => <ComingLater title="nav.team" /> });

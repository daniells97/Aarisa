import { createFileRoute } from '@tanstack/react-router';
import { ComingLater } from '~/ui/ComingLater';

export const Route = createFileRoute('/_app/payroll')({ component: () => <ComingLater title="nav.payroll" /> });

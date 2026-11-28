import { createFileRoute } from '@tanstack/react-router';
import { integrationCall } from '~/server/integration-http';
import { applyDailyChanges, dailyChangesInput } from '~/server/integrations';

export const Route = createFileRoute('/api/integrations/daily-changes')({
  server: { handlers: { POST: ({ request }) => integrationCall(request, dailyChangesInput, (tx, input) => applyDailyChanges(tx, input)) } },
});

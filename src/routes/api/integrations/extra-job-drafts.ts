import { createFileRoute } from '@tanstack/react-router';
import { integrationCall } from '~/server/integration-http';
import { createExtraJobDraft, extraJobDraftInput } from '~/server/integrations';

export const Route = createFileRoute('/api/integrations/extra-job-drafts')({
  server: { handlers: { POST: ({ request }) => integrationCall(request, extraJobDraftInput, (tx, input) => createExtraJobDraft(tx, input)) } },
});

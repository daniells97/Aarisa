import { createFileRoute } from '@tanstack/react-router';
import { integrationCall } from '~/server/integration-http';
import { logMessage, messageInput } from '~/server/integrations';

export const Route = createFileRoute('/api/integrations/messages')({
  server: {
    handlers: {
      POST: ({ request }) => integrationCall(request, messageInput, async (tx, input) => {
        const m = await logMessage(tx, input);
        return { id: m.id, userId: m.userId };
      }),
    },
  },
});

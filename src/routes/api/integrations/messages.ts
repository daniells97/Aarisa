import { createFileRoute } from '@tanstack/react-router';
import { integrationCall } from '~/server/integration-http';
import { actorForPhone, logMessage, messageInput } from '~/server/integrations';

export const Route = createFileRoute('/api/integrations/messages')({
  server: {
    handlers: {
      POST: ({ request }) => integrationCall(request, messageInput, async (tx, input) => {
        const m = await logMessage(tx, input);
        // The sender's language, so n8n answers in it.
        const sender = m.userId && input.direction === 'in' ? await actorForPhone(tx, input.phone) : null;
        return { id: m.id, userId: m.userId, locale: sender?.locale ?? 'en' };
      }),
    },
  },
});

import { createFileRoute } from '@tanstack/react-router';
import { integrationCall } from '~/server/integration-http';
import { menuInput, whatsappMenu } from '~/server/whatsapp-menu';

export const Route = createFileRoute('/api/integrations/whatsapp-menu')({
  server: { handlers: { POST: ({ request }) => integrationCall(request, menuInput, (tx, input) => whatsappMenu(tx, input)) } },
});

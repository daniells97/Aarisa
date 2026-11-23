import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { integrationCall } from '~/server/integration-http';
import { sendMorningEmails } from '~/server/morning-email';

export const Route = createFileRoute('/api/integrations/morning-email')({
  server: { handlers: { POST: ({ request }) => integrationCall(request, z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }), (tx, input) => sendMorningEmails(tx, input.date)) } },
});

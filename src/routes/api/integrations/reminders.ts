import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { integrationCall } from '~/server/integration-http';
import { orderNumberReminders } from '~/server/integrations';

export const Route = createFileRoute('/api/integrations/reminders')({
  server: {
    handlers: {
      GET: ({ request }) => integrationCall(request, z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }), (tx, input) => orderNumberReminders(tx, input.date)),
    },
  },
});

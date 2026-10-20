import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { integrationCall } from '~/server/integration-http';
import { morningList } from '~/server/integrations';

export const Route = createFileRoute('/api/integrations/morning-list')({
  server: {
    handlers: {
      GET: ({ request }) => integrationCall(request, z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }), (tx, input) => morningList(tx, input.date)),
    },
  },
});

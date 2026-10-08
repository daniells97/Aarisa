import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { SYSTEM_ACTOR } from '~/server/actor';
import { importHovership } from '~/server/hovership';
import { integrationCall } from '~/server/integration-http';
import { importTforce } from '~/server/tforce';

// n8n report ingest: a client report from the mailbox. Same import and states as an upload (6.12).
const body = z.object({
  operation: z.enum(['hovership', 'tforce']),
  fileName: z.string().min(1).max(200),
  text: z.string().min(1).max(5_000_000), // the CSV content
});

export const Route = createFileRoute('/api/integrations/imports')({
  server: {
    handlers: {
      POST: ({ request }) => integrationCall(request, body, async (tx, input) => {
        const actor = { ...SYSTEM_ACTOR, source: 'email-import' as const };
        try {
          const file = { fileName: input.fileName, text: input.text, channel: 'email' as const };
          return input.operation === 'hovership' ? await importHovership(tx, actor, file) : await importTforce(tx, actor, file);
        } catch (e) {
          if ((e as { code?: string }).code === 'already_imported') return { status: 'already_imported' };
          throw e;
        }
      }),
    },
  },
});

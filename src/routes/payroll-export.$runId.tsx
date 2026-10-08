import { createFileRoute } from '@tanstack/react-router';
import { db } from '~/db/client';
import { currentActor } from '~/server/auth';
import { exportRun } from '~/server/payroll';
import { ForbiddenError, UnauthorizedError } from '~/server/actor';
import { RuleError } from '~/server/errors';

// Downloads the payroll file for a run. Permission is checked on the server (payroll.export).
export const Route = createFileRoute('/payroll-export/$runId')({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const actor = await currentActor();
        try {
          if (!actor) throw new UnauthorizedError();
          const file = await db().transaction((tx) => exportRun(tx, actor, params.runId));
          return new Response(file.csv, {
            headers: {
              'content-type': 'text/csv; charset=utf-8',
              'content-disposition': `attachment; filename="${file.fileName}"`,
              'cache-control': 'no-store',
            },
          });
        } catch (e) {
          if (e instanceof UnauthorizedError) return new Response('Sign in required', { status: 401 });
          if (e instanceof ForbiddenError) return new Response('Not allowed', { status: 403 });
          if (e instanceof RuleError) return new Response('Not found', { status: 404 });
          throw e;
        }
      },
    },
  },
});

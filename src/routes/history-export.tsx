import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { db } from '~/db/client';
import { todayLA } from '~/domain/dates';
import { translate, type MessageKey } from '~/i18n';
import { currentActor } from '~/server/auth';
import { ForbiddenError, UnauthorizedError } from '~/server/actor';
import { RuleError } from '~/server/errors';
import { loadHistory } from '~/server/history';
import { xlsx } from '~/server/xlsx';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const query = z.object({
  from: isoDate, to: isoDate,
  op: z.string().regex(/^[a-z0-9_]{1,40}$/).optional(), driver: z.string().uuid().optional(), code: z.string().uuid().optional(),
});

// History as an Excel file, with the same filters as the screen and every row (the screen shows the last
// 1,000). Two sheets: day by day, and by person. Same permission as the screen (payroll.view), no money.
export const Route = createFileRoute('/history-export')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const actor = await currentActor();
        try {
          if (!actor) throw new UnauthorizedError();
          const q = query.safeParse(Object.fromEntries(new URL(request.url).searchParams));
          if (!q.success) return new Response('Bad request', { status: 400 });
          const { from, to, op, driver, code } = q.data;
          const data = await db().transaction((tx) => loadHistory(tx, actor, { from, to, operation: op, driverId: driver, routeId: code }, todayLA(), { allRows: true }));
          const t = (k: MessageKey) => translate(actor.locale, k);
          const opName = new Map(data.options.operations.map((o) => [o.code, o.name]));
          const file = xlsx([
            {
              name: t('hi.detail'),
              header: [t('hi.date'), t('hi.contract'), t('td.route'), t('hi.person'), t('hi.company'), t('hi.routes'), t('hi.pieces')],
              rows: data.rows.slice().reverse().map((r) => [
                r.date, opName.get(r.operation) ?? r.operation, r.driverCode ?? '', r.name ?? (r.rawName ? `“${r.rawName}”` : t('td.noDriver')),
                r.company && r.driverId ? r.company : '', r.sortCodes.join(', '), r.pieces,
              ]),
            },
            {
              name: t('hi.byPerson'),
              header: [t('hi.person'), t('hi.days'), t('hi.pieces'), t('hi.driverCodes'), t('hi.routes')],
              rows: data.byPerson.map((p) => [p.name, p.days, p.pieces, p.driverCodes.join(', '), p.sortCodes.map((x) => (x.days > 1 ? `${x.code} ×${x.days}` : x.code)).join(', ')]),
            },
          ]);
          const name = `${t('hi.fileName')}-${from}${from === to ? '' : `_${to}`}.xlsx`;
          return new Response(new Uint8Array(file), {
            headers: {
              'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
              'content-disposition': `attachment; filename="${name}"`,
              'cache-control': 'no-store',
            },
          });
        } catch (e) {
          if (e instanceof UnauthorizedError) return new Response('Sign in required', { status: 401 });
          if (e instanceof ForbiddenError) return new Response('Not allowed', { status: 403 });
          if (e instanceof RuleError) return new Response('Bad request', { status: 400 });
          throw e;
        }
      },
    },
  },
});

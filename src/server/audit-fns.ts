import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { read } from './fn';
import { AUDIT_TABLES, listAudit } from './audit-view';

export const getAudit = createServerFn({ method: 'GET' })
  .validator(z.object({ table: z.enum(AUDIT_TABLES).optional(), before: z.string().datetime().optional() }))
  .handler(({ data }) => read('audit.view', (tx, actor) => listAudit(tx, actor, data)));

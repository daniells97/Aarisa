import type { z } from 'zod';
import { db, type Tx } from '~/db/client';
import { ForbiddenError, UnauthorizedError } from './actor';
import { RuleError } from './errors';
import { serviceTokenValid } from './integrations';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

/**
 * Wraps an integration endpoint: checks the n8n service token, validates the body with zod,
 * runs in one transaction (audit rows commit with the change) and maps rule errors to status codes.
 */
export async function integrationCall<S extends z.ZodTypeAny, T>(request: Request, schema: S | null, fn: (tx: Tx, input: z.infer<S>) => Promise<T>) {
  if (!serviceTokenValid(request.headers.get('authorization'))) return json(401, { error: 'unauthorized' });
  let input: unknown = undefined;
  if (schema) {
    let raw: unknown;
    try { raw = request.method === 'GET' ? Object.fromEntries(new URL(request.url).searchParams) : await request.json(); }
    catch { return json(400, { error: 'invalid_json' }); }
    const parsed = schema.safeParse(raw);
    if (!parsed.success) return json(400, { error: 'invalid_input', issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });
    input = parsed.data;
  }
  try {
    return json(200, await db().transaction((tx) => fn(tx, input as z.infer<S>)));
  } catch (e) {
    if (e instanceof RuleError) return json(422, { error: e.code });
    if (e instanceof ForbiddenError) return json(403, { error: 'forbidden', permission: e.permission });
    if (e instanceof UnauthorizedError) return json(401, { error: 'unauthorized' });
    console.error('Integration call failed', e);
    return json(500, { error: 'server_error' });
  }
}

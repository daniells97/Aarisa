import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

export type Db = ReturnType<typeof createDb>;
/** A transaction handle; server functions write data and audit rows through one of these. */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export function createDb(url = process.env.DATABASE_URL) {
  if (!url) throw new Error('DATABASE_URL is not set');
  // prepare: false keeps us compatible with PgBouncer in transaction mode.
  const client = postgres(url, { prepare: false, max: 10 });
  return drizzle(client, { schema, casing: 'snake_case' });
}

let shared: Db | undefined;
export function db(): Db {
  shared ??= createDb();
  return shared;
}

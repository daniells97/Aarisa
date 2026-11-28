// Rebuilds a drizzle-kit snapshot from src/db/schema.ts. Use it after a hand-written migration made with
// `drizzle-kit generate --custom`, which copies the previous snapshot instead of reading the schema:
// tsx scripts/drizzle-snapshot.ts 0004_snapshot.json 0003_snapshot.json
import { readFileSync, writeFileSync } from 'node:fs';
import { generateDrizzleJson } from 'drizzle-kit/api';
import * as schema from '../src/db/schema';
const dir = new URL('../drizzle/meta/', import.meta.url).pathname;
const [target, prev] = process.argv.slice(2);
const p = JSON.parse(readFileSync(dir + prev, 'utf8'));
const old = JSON.parse(readFileSync(dir + target, 'utf8'));
const snap = generateDrizzleJson(schema as Record<string, unknown>, p.id);
(snap as { id: string }).id = old.id;
writeFileSync(dir + target, JSON.stringify(snap, null, 2) + '\n');
console.log(Object.keys(snap.tables).length, Object.keys(snap.enums).length, Object.keys(snap.schemas));

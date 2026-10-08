import 'dotenv/config';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { createDb } from './client';

const database = createDb();
await migrate(database, { migrationsFolder: './drizzle' });
console.log('Migrations applied');
await database.$client.end();

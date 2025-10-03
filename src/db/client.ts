import { Pool } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from './schema';

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL is not defined');
}

const pool = new Pool({ connectionString });

export const db = drizzle(pool, { schema });

let initialized = false;

export async function initDb() {
  if (initialized) {
    return;
  }

  await pool.query('select 1');
  initialized = true;
}

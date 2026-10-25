import pg from 'pg';
import { createPool } from '../src/db/pool.js';
import { migrate } from '../src/db/migrate.js';

export const TEST_DB_URL = process.env.TEST_DATABASE_URL ?? 'postgres://postgres@127.0.0.1:5432/aste_test';

// Ricrea da zero il database di test e applica le migrazioni.
export default async function setup() {
  const url = new URL(TEST_DB_URL);
  const dbName = url.pathname.slice(1);
  url.pathname = '/postgres';
  const admin = new pg.Client({ connectionString: url.toString() });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${dbName}`);
  await admin.end();
  const db = createPool(TEST_DB_URL);
  await migrate(db);
  await db.end();
}

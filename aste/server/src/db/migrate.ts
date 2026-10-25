import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createPool, tx, type Db } from './pool.js';

const MIGRATIONS_DIR = fileURLToPath(new URL('../../migrations/', import.meta.url));

// Applica in ordine i file .sql non ancora eseguiti, ciascuno in una transazione.
// Il lock advisory impedisce a due istanze di migrare in contemporanea.
export async function migrate(db: Db): Promise<string[]> {
  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
  return tx(db, async (c) => {
    await c.query('SELECT pg_advisory_xact_lock(727274)');
    await c.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    const { rows } = await c.query<{ name: string }>('SELECT name FROM schema_migrations');
    const done = new Set(rows.map((r) => r.name));
    const applied: string[] = [];
    for (const file of files) {
      if (done.has(file)) continue;
      await c.query(await readFile(MIGRATIONS_DIR + file, 'utf8'));
      await c.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
      applied.push(file);
    }
    return applied;
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL mancante');
  const db = createPool(url);
  const applied = await migrate(db);
  process.stdout.write(applied.length ? `Applicate: ${applied.join(', ')}\n` : 'Database aggiornato\n');
  await db.end();
}

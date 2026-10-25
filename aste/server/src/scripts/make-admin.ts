import { fileURLToPath } from 'node:url';
import { createPool } from '../db/pool.js';

// Promuove un utente esistente ad amministratore (moderazione e contestazioni).
// Uso: npm run make-admin -- email@esempio.it   (in Docker: node dist/scripts/make-admin.js email)
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const email = process.argv[2];
  if (!email || !process.env.DATABASE_URL) {
    process.stderr.write('Uso: DATABASE_URL=... make-admin <email>\n');
    process.exit(1);
  }
  const db = createPool(process.env.DATABASE_URL);
  const { rowCount } = await db.query("UPDATE users SET role = 'admin' WHERE email = $1 AND status = 'active'", [email]);
  process.stdout.write(rowCount ? `${email} è ora amministratore\n` : `Nessun utente attivo con email ${email}\n`);
  await db.end();
  process.exit(rowCount ? 0 : 1);
}

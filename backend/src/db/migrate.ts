import fs from 'fs';
import path from 'path';
import { pool } from './pool';

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

/** Applies pending .sql files in lexical order, each in its own transaction. */
export async function runMigrations(): Promise<void> {
  await pool.query(
    'CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())'
  );
  const applied = new Set((await pool.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name as string));
  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
      await client.query('COMMIT');
      console.log(`Applied migration ${file}`);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
}

if (require.main === module) {
  runMigrations()
    .then(() => pool.end())
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

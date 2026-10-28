import fs from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';
import { config } from './config';
import { pool } from './db/pool';
import { runMigrations } from './db/migrate';
import type { DatasetKey } from './importers/parse';
import { parseInWorker } from './importers/runParse';
import { persistUpload } from './importers/persist';
import { dataStore } from './services/dataStore';

export const seedState = { running: false };

/** Dataset -> file shipped in the repo's data/ folder (the same defaults the original app preloaded). */
const SEED_FILES: Array<{ dataset: DatasetKey; file: string }> = [
  { dataset: 'gl', file: 'GL_category_mapping.xlsx' },
  { dataset: 'target', file: 'Target_26_27.xlsx' },
  { dataset: 'expenses', file: 'Expenses_Report.xlsx' },
  { dataset: 'sales', file: 'Sales_Report.xlsx' },
  { dataset: 'mm60', file: 'MM60_Item_Cost.xlsx' },
  { dataset: 'vk13', file: 'VK13_Pricing.xlsx' }
];

/** Creates the first administrator from ADMIN_EMAIL / ADMIN_PASSWORD when no users exist yet. */
export async function ensureAdminUser(): Promise<void> {
  const { rows } = await pool.query('SELECT count(*)::int AS n FROM users');
  if (rows[0].n > 0) return;
  if (!config.adminEmail || !config.adminPassword) {
    console.warn('No users exist and ADMIN_EMAIL / ADMIN_PASSWORD are not set - nobody will be able to sign in.');
    return;
  }
  if (config.adminPassword.length < 8) throw new Error('ADMIN_PASSWORD must be at least 8 characters.');
  await pool.query('INSERT INTO users (email, name, password_hash, role) VALUES ($1, $2, $3, $4)', [
    config.adminEmail.toLowerCase(),
    config.adminName,
    await bcrypt.hash(config.adminPassword, 10),
    'admin'
  ]);
  console.log(`Created initial administrator ${config.adminEmail}`);
}

/** Loads the bundled data files for every dataset that has never been uploaded. Idempotent. */
export async function seedDatasets(dir = config.seedDataDir): Promise<void> {
  const done = new Set((await pool.query('SELECT DISTINCT dataset FROM upload_batches')).rows.map((r) => r.dataset as string));
  const pending = SEED_FILES.filter((s) => !done.has(s.dataset) && fs.existsSync(path.join(dir, s.file)));
  if (!pending.length) return;
  seedState.running = true;
  try {
    for (const { dataset, file } of pending) {
      const started = Date.now();
      console.log(`Seeding ${dataset} from ${file} ...`);
      const parsed = await parseInWorker(dataset, fs.readFileSync(path.join(dir, file)));
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await persistUpload(client, parsed, file, null);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
      console.log(`Seeded ${dataset}: ${parsed.rowCount} rows in ${((Date.now() - started) / 1000).toFixed(1)}s`);
    }
    dataStore.invalidate();
  } finally {
    seedState.running = false;
  }
}

if (require.main === module) {
  (async () => {
    await runMigrations();
    await ensureAdminUser();
    await seedDatasets(process.argv[2] || config.seedDataDir);
    await pool.end();
  })().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

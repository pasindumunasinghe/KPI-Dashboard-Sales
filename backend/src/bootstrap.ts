import bcrypt from 'bcryptjs';
import { config } from './config';
import { pool } from './db/pool';

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

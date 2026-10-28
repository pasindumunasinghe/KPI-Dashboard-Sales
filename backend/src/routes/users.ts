import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { pool } from '../db/pool';
import { requireAuth, requireRole } from '../middleware/auth';

export const usersRouter = Router();
usersRouter.use(requireAuth, requireRole('admin'));

const roleSchema = z.enum(['admin', 'finance', 'viewer']);

const publicColumns = 'id, email, name, role, is_active AS "isActive", created_at AS "createdAt", last_login_at AS "lastLoginAt"';

usersRouter.get('/', async (_req, res) => {
  const { rows } = await pool.query(`SELECT ${publicColumns} FROM users ORDER BY id`);
  res.json({ users: rows });
});

const createSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  name: z.string().trim().min(1),
  password: z.string().min(8),
  role: roleSchema
});

usersRouter.post('/', async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Provide a valid email, a name, a password of at least 8 characters and a role.' });
    return;
  }
  const { email, name, password, role } = parsed.data;
  const exists = await pool.query('SELECT 1 FROM users WHERE email = $1', [email]);
  if (exists.rowCount) {
    res.status(409).json({ error: 'A user with this email already exists.' });
    return;
  }
  const { rows } = await pool.query(
    `INSERT INTO users (email, name, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING ${publicColumns}`,
    [email, name, await bcrypt.hash(password, 10), role]
  );
  res.status(201).json({ user: rows[0] });
});

const updateSchema = z.object({
  name: z.string().trim().min(1).optional(),
  role: roleSchema.optional(),
  isActive: z.boolean().optional(),
  password: z.string().min(8).optional()
});

async function activeAdminCount(excludingId: number): Promise<number> {
  const { rows } = await pool.query(`SELECT count(*)::int AS n FROM users WHERE role = 'admin' AND is_active AND id <> $1`, [excludingId]);
  return rows[0].n;
}

usersRouter.patch('/:id', async (req, res) => {
  const id = Number(req.params.id);
  const parsed = updateSchema.safeParse(req.body);
  if (!Number.isInteger(id) || !parsed.success) {
    res.status(400).json({ error: 'Invalid request.' });
    return;
  }
  const target = await pool.query('SELECT role, is_active FROM users WHERE id = $1', [id]);
  if (!target.rowCount) {
    res.status(404).json({ error: 'User not found.' });
    return;
  }
  const { name, role, isActive, password } = parsed.data;
  const demotes = target.rows[0].role === 'admin' && ((role && role !== 'admin') || isActive === false);
  if (demotes && (await activeAdminCount(id)) === 0) {
    res.status(400).json({ error: 'At least one active administrator is required.' });
    return;
  }
  const { rows } = await pool.query(
    `UPDATE users SET
       name = COALESCE($2, name),
       role = COALESCE($3, role),
       is_active = COALESCE($4, is_active),
       password_hash = COALESCE($5, password_hash)
     WHERE id = $1 RETURNING ${publicColumns}`,
    [id, name ?? null, role ?? null, isActive ?? null, password ? await bcrypt.hash(password, 10) : null]
  );
  res.json({ user: rows[0] });
});

usersRouter.delete('/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user!.id) {
    res.status(400).json({ error: 'You cannot delete your own account.' });
    return;
  }
  const target = await pool.query('SELECT role FROM users WHERE id = $1', [id]);
  if (!target.rowCount) {
    res.status(404).json({ error: 'User not found.' });
    return;
  }
  if (target.rows[0].role === 'admin' && (await activeAdminCount(id)) === 0) {
    res.status(400).json({ error: 'At least one active administrator is required.' });
    return;
  }
  await pool.query('DELETE FROM users WHERE id = $1', [id]);
  res.json({ ok: true });
});

import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { pool } from '../db/pool';
import { requireAuth, signToken } from '../middleware/auth';
import { clearFailures, isLockedOut, recordFailure } from '../middleware/loginLimiter';

export const authRouter = Router();

const loginSchema = z.object({ email: z.string().trim().toLowerCase().min(1), password: z.string().min(1) });

authRouter.post('/login', async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Please enter an email and password.' });
    return;
  }
  const { email, password } = parsed.data;
  const limiterKey = `${req.ip}|${email}`;
  if (isLockedOut(limiterKey)) {
    res.status(429).json({ error: 'Too many failed attempts. Try again in a few minutes.' });
    return;
  }
  const { rows } = await pool.query('SELECT id, email, name, role, password_hash, is_active FROM users WHERE email = $1', [email]);
  const user = rows[0];
  const ok = user && user.is_active && (await bcrypt.compare(password, user.password_hash));
  if (!ok) {
    recordFailure(limiterKey);
    res.status(401).json({ error: 'Invalid email or password.' });
    return;
  }
  clearFailures(limiterKey);
  await pool.query('UPDATE users SET last_login_at = now() WHERE id = $1', [user.id]);
  const authUser = { id: user.id, email: user.email, name: user.name, role: user.role };
  res.json({ token: signToken(authUser), user: authUser });
});

authRouter.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

const changePasswordSchema = z.object({ currentPassword: z.string().min(1), newPassword: z.string().min(8) });

authRouter.post('/change-password', requireAuth, async (req, res) => {
  const parsed = changePasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'New password must be at least 8 characters.' });
    return;
  }
  const { rows } = await pool.query('SELECT password_hash FROM users WHERE id = $1', [req.user!.id]);
  if (!(await bcrypt.compare(parsed.data.currentPassword, rows[0].password_hash))) {
    res.status(400).json({ error: 'Current password is incorrect.' });
    return;
  }
  await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [await bcrypt.hash(parsed.data.newPassword, 10), req.user!.id]);
  res.json({ ok: true });
});

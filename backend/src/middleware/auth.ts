import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { pool } from '../db/pool';

export type Role = 'admin' | 'finance' | 'viewer';

export interface AuthUser {
  id: number;
  email: string;
  name: string;
  role: Role;
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthUser;
  }
}

export function signToken(user: AuthUser): string {
  return jwt.sign({ sub: String(user.id) }, config.jwtSecret, { expiresIn: config.jwtExpiresIn as jwt.SignOptions['expiresIn'] });
}

/** Verifies the Bearer token and loads the current (active) user, so role changes apply immediately. */
export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  try {
    const payload = jwt.verify(token, config.jwtSecret) as jwt.JwtPayload;
    const { rows } = await pool.query('SELECT id, email, name, role, is_active FROM users WHERE id = $1', [Number(payload.sub)]);
    const user = rows[0];
    if (!user || !user.is_active) {
      res.status(401).json({ error: 'Account is disabled or no longer exists' });
      return;
    }
    req.user = { id: user.id, email: user.email, name: user.name, role: user.role };
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired session' });
  }
}

export function requireRole(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user || !roles.includes(req.user.role)) {
      res.status(403).json({ error: 'You do not have permission to perform this action' });
      return;
    }
    next();
  };
}

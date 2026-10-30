import type { PoolClient } from 'pg';
import { pool } from '../db/pool';
import { fiscalMonths, findMonth, type FiscalMonth } from '../fiscal';
import { MONTHLY_DATASETS, MONTHLY_KEYS, REQUIRED_FOR_LOCK, type MonthlyDataset } from '../importers/monthly';
import { dataStore } from './dataStore';

/** Thrown when a change is attempted on a locked month (HTTP 423). */
export class PeriodLockedError extends Error {
  constructor(public period: string, label?: string) {
    super(`${label || period} is locked. An administrator must unlock it before its data can be changed.`);
    this.name = 'PeriodLockedError';
  }
}

/** Thrown for lock/unlock requests that can't be applied (HTTP 409/422). */
export class PeriodStateError extends Error {
  constructor(message: string, public status: 409 | 422) {
    super(message);
    this.name = 'PeriodStateError';
  }
}

/** Matches the database trigger's error (SQLSTATE LK423). */
export function isPeriodLockDbError(err: unknown): err is { code: string; message: string } {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === 'LK423';
}

/**
 * Takes a row lock on the month's `periods` row (creating it if needed) for the rest of
 * the transaction, then rejects if the month is locked. Concurrent lock requests and
 * uploads for the same month therefore serialise instead of racing.
 */
export async function lockPeriodForWrite(client: PoolClient, month: FiscalMonth): Promise<void> {
  await client.query('INSERT INTO periods (period) VALUES ($1) ON CONFLICT DO NOTHING', [month.period]);
  const { rows } = await client.query('SELECT status FROM periods WHERE period = $1 FOR UPDATE', [month.period]);
  if (rows[0].status === 'locked') throw new PeriodLockedError(month.period, month.label);
}

export async function isPeriodLocked(period: string): Promise<boolean> {
  const { rows } = await pool.query("SELECT 1 FROM periods WHERE period = $1 AND status = 'locked'", [period]);
  return rows.length > 0;
}

export interface MonthDatasetInfo {
  rowCount: number;
  fileName: string | null;
  uploadedAt: string | null;
  uploadedBy: string | null;
}

export interface PeriodInfo {
  month: string;
  period: string;
  label: string;
  status: 'open' | 'locked';
  lockedAt: string | null;
  lockedBy: string | null;
  electricianPoint: number;
  data: Record<MonthlyDataset, MonthDatasetInfo>;
  lastEvent: { action: 'lock' | 'unlock'; by: string | null; at: string; note: string | null } | null;
}

async function rowCountsByPeriod(): Promise<Record<MonthlyDataset, Map<string, number>>> {
  const out = {} as Record<MonthlyDataset, Map<string, number>>;
  for (const key of MONTHLY_KEYS) {
    const def = MONTHLY_DATASETS[key];
    const expr = def.kind === 'date' ? `to_char(${def.column}, 'YYYY-MM')` : def.column;
    const { rows } = await pool.query(`SELECT ${expr} AS p, count(*)::int AS n FROM ${def.table} GROUP BY 1`);
    out[key] = new Map(rows.filter((r) => r.p).map((r) => [r.p as string, r.n as number]));
  }
  return out;
}

export async function listPeriods(): Promise<PeriodInfo[]> {
  const counts = await rowCountsByPeriod();
  const [periodRows, batchRows, eventRows] = await Promise.all([
    pool.query(
      `SELECT p.period, p.status, p.locked_at, p.electrician_point, u.name AS locked_by
         FROM periods p LEFT JOIN users u ON u.id = p.locked_by`
    ),
    pool.query(
      `SELECT DISTINCT ON (b.dataset, b.period) b.dataset, b.period, b.file_name, b.uploaded_at, u.name AS uploaded_by
         FROM upload_batches b LEFT JOIN users u ON u.id = b.uploaded_by
        WHERE b.period IS NOT NULL ORDER BY b.dataset, b.period, b.uploaded_at DESC, b.id DESC`
    ),
    pool.query(
      `SELECT DISTINCT ON (e.period) e.period, e.action, e.note, e.created_at, u.name AS by
         FROM period_events e LEFT JOIN users u ON u.id = e.user_id ORDER BY e.period, e.created_at DESC, e.id DESC`
    )
  ]);
  const periods = new Map(periodRows.rows.map((r) => [r.period as string, r]));
  const batches = new Map(batchRows.rows.map((r) => [`${r.dataset}|${r.period}`, r]));
  const events = new Map(eventRows.rows.map((r) => [r.period as string, r]));

  return fiscalMonths().map((m) => {
    const p = periods.get(m.period);
    const data = {} as Record<MonthlyDataset, MonthDatasetInfo>;
    for (const key of MONTHLY_KEYS) {
      const rowCount = counts[key].get(m.period) || 0;
      const b = batches.get(`${key}|${m.period}`);
      data[key] = {
        rowCount,
        fileName: rowCount && b ? b.file_name : null,
        uploadedAt: rowCount && b ? (b.uploaded_at as Date).toISOString() : null,
        uploadedBy: rowCount && b ? b.uploaded_by : null
      };
    }
    const ev = events.get(m.period);
    return {
      month: m.month,
      period: m.period,
      label: m.label,
      status: p?.status === 'locked' ? 'locked' : 'open',
      lockedAt: p?.locked_at ? (p.locked_at as Date).toISOString() : null,
      lockedBy: p?.status === 'locked' ? p.locked_by : null,
      electricianPoint: p ? Number(p.electrician_point) : 0,
      data,
      lastEvent: ev ? { action: ev.action, by: ev.by, at: (ev.created_at as Date).toISOString(), note: ev.note } : null
    };
  });
}

export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Locks a month once its core data (Sales + Expenses) has been uploaded. */
export async function lockPeriod(monthName: string, userId: number): Promise<void> {
  const month = findMonth(monthName);
  if (!month) throw new PeriodStateError('Unknown month.', 422);
  await withTransaction(async (client) => {
    await client.query('INSERT INTO periods (period) VALUES ($1) ON CONFLICT DO NOTHING', [month.period]);
    const { rows } = await client.query('SELECT status FROM periods WHERE period = $1 FOR UPDATE', [month.period]);
    if (rows[0].status === 'locked') throw new PeriodStateError(`${month.label} is already locked.`, 409);

    const missing: string[] = [];
    for (const key of REQUIRED_FOR_LOCK) {
      const def = MONTHLY_DATASETS[key];
      const { rows: c } =
        def.kind === 'date'
          ? await client.query(`SELECT 1 FROM ${def.table} WHERE ${def.column} >= $1::date AND ${def.column} < $2::date LIMIT 1`, [month.from, month.to])
          : await client.query(`SELECT 1 FROM ${def.table} WHERE ${def.column} = $1 LIMIT 1`, [month.period]);
      if (!c.length) missing.push(def.label);
    }
    if (missing.length) {
      throw new PeriodStateError(`Upload ${missing.join(' and ')} for ${month.label} before locking it.`, 422);
    }
    await client.query("UPDATE periods SET status = 'locked', locked_by = $2, locked_at = now(), updated_at = now() WHERE period = $1", [month.period, userId]);
    await client.query("INSERT INTO period_events (period, action, user_id) VALUES ($1, 'lock', $2)", [month.period, userId]);
  });
}

export async function unlockPeriod(monthName: string, userId: number, note: string | null): Promise<void> {
  const month = findMonth(monthName);
  if (!month) throw new PeriodStateError('Unknown month.', 422);
  await withTransaction(async (client) => {
    const { rows } = await client.query('SELECT status FROM periods WHERE period = $1 FOR UPDATE', [month.period]);
    if (!rows.length || rows[0].status !== 'locked') throw new PeriodStateError(`${month.label} is not locked.`, 409);
    await client.query("UPDATE periods SET status = 'open', locked_by = NULL, locked_at = NULL, updated_at = now() WHERE period = $1", [month.period]);
    await client.query("INSERT INTO period_events (period, action, note, user_id) VALUES ($1, 'unlock', $2, $3)", [month.period, note, userId]);
  });
}

/** The month's manually entered Electrician Point amount. Refused while the month is locked. */
export async function setElectricianPoint(monthName: string, value: number): Promise<void> {
  const month = findMonth(monthName);
  if (!month) throw new PeriodStateError('Unknown month.', 422);
  await withTransaction(async (client) => {
    await lockPeriodForWrite(client, month);
    await client.query('UPDATE periods SET electrician_point = $2, updated_at = now() WHERE period = $1', [month.period, value]);
  });
  dataStore.invalidate();
}

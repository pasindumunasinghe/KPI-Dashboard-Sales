import { pool } from '../db/pool';
import { DashboardCalc as Calc } from '../calc/calc';
import { rowsForMonth } from './allocation';
import { dataStore } from './dataStore';
import { FINANCIAL_YEAR_LABEL } from '../fiscal';

export interface Snapshot {
  financialYear: string;
  month: string;
  uploadDate: string;
  snapshotCreatedDate: string;
  version: number;
  kpis: Record<string, number>;
  mainChannelBreakdown: Array<{ channel: string; sales: number; cogs: number; grossProfit: number }>;
}

export interface SnapshotSummary {
  id: number;
  financialYear: string;
  month: string;
  version: number;
  createdAt: string;
  createdBy: string | null;
}

const FINANCIAL_YEAR = FINANCIAL_YEAR_LABEL;

export async function listSnapshots(): Promise<SnapshotSummary[]> {
  const { rows } = await pool.query(
    `SELECT s.id, s.financial_year, s.month, s.version, s.created_at, u.name AS created_by
       FROM monthly_snapshots s LEFT JOIN users u ON u.id = s.created_by
      WHERE s.financial_year = $1 ORDER BY s.created_at DESC`,
    [FINANCIAL_YEAR]
  );
  return rows.map((r) => ({
    id: r.id,
    financialYear: r.financial_year,
    month: r.month,
    version: r.version,
    createdAt: (r.created_at as Date).toISOString(),
    createdBy: r.created_by
  }));
}

/** Highest version per month — what the comparison and YTD tabs read. */
export async function getLatestSnapshotsByMonth(): Promise<Map<string, Snapshot>> {
  const { rows } = await pool.query(
    `SELECT DISTINCT ON (month) month, data FROM monthly_snapshots
      WHERE financial_year = $1 ORDER BY month, version DESC`,
    [FINANCIAL_YEAR]
  );
  return new Map(rows.map((r) => [r.month as string, r.data as Snapshot]));
}

export async function saveSnapshot(
  input: { month: string; mode: 'replace' | 'new_version'; gpTargetPct: number; npatTargetPct: number },
  userId: number | null
): Promise<Snapshot> {
  const ctx = await dataStore.get();
  const existing = await pool.query(
    'SELECT max(version) AS v FROM monthly_snapshots WHERE financial_year = $1 AND month = $2',
    [FINANCIAL_YEAR, input.month]
  );
  const latest: number | null = existing.rows[0].v;
  let version = 1;
  if (latest !== null) version = input.mode === 'replace' ? latest : latest + 1;

  const snapshot: Snapshot = Calc.buildMonthlySnapshot(ctx.dataset, {
    month: input.month,
    version,
    financialYear: FINANCIAL_YEAR,
    uploadDate: ctx.lastUpdated || undefined,
    gpTargetPct: input.gpTargetPct,
    npatTargetPct: input.npatTargetPct,
    distributorExclusionRows: ctx.files.distributorExclusionRows,
    debtorRows: rowsForMonth(ctx.files.debtorRows, input.month),
    electricianPointValue: ctx.electricianByMonth[input.month] || 0,
    inventoryRows: ctx.files.inventoryRows
  });

  await pool.query(
    `INSERT INTO monthly_snapshots (financial_year, month, version, data, created_by)
     VALUES ($1, $2, $3, $4::jsonb, $5)
     ON CONFLICT (financial_year, month, version)
     DO UPDATE SET data = EXCLUDED.data, created_by = EXCLUDED.created_by, created_at = now()`,
    [FINANCIAL_YEAR, input.month, version, JSON.stringify(snapshot), userId]
  );
  return snapshot;
}

export async function deleteSnapshot(id: number): Promise<boolean> {
  const res = await pool.query('DELETE FROM monthly_snapshots WHERE id = $1', [id]);
  return (res.rowCount ?? 0) > 0;
}

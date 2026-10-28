import type { PoolClient } from 'pg';
import { findMonth } from '../fiscal';
import { lockPeriodForWrite } from '../services/periods';
import { MONTHLY_DATASETS, isMonthly } from './monthly';
import type { ParsedUpload } from './parse';

const BATCH_SIZE = 10000;

/** Deletes one month's rows from a month-based table (never touches other months). */
async function deleteMonthRows(client: PoolClient, dataset: keyof typeof MONTHLY_DATASETS, month: { period: string; from: string; to: string }) {
  const def = MONTHLY_DATASETS[dataset];
  if (def.kind === 'date') {
    await client.query(`DELETE FROM ${def.table} WHERE ${def.column} >= $1::date AND ${def.column} < $2::date`, [month.from, month.to]);
  } else {
    await client.query(`DELETE FROM ${def.table} WHERE ${def.column} = $1`, [month.period]);
  }
}

/**
 * Stores a parsed upload. Reference datasets replace the whole table (as in the original
 * app); month-based datasets replace only the selected month's rows and are refused,
 * inside the same transaction, if that month is locked. Must run inside a transaction.
 */
export async function persistUpload(client: PoolClient, parsed: ParsedUpload, fileName: string, userId: number | null): Promise<void> {
  // Table and column names come from our own parsers, never from user input.
  if (isMonthly(parsed.dataset)) {
    const month = findMonth(parsed.scope?.month);
    if (!month) throw new Error('Month-based upload without a month');
    await lockPeriodForWrite(client, month);
    await deleteMonthRows(client, parsed.dataset, month);
  } else {
    await client.query(`TRUNCATE TABLE ${parsed.table} RESTART IDENTITY`);
  }

  const names = parsed.columns.map((c) => c.name);
  const unnestArgs = parsed.columns.map((c, i) => `$${i + 1}::${c.type}[]`).join(', ');
  const sql = `INSERT INTO ${parsed.table} (${names.join(', ')}) SELECT * FROM unnest(${unnestArgs})`;
  for (let start = 0; start < parsed.rowCount; start += BATCH_SIZE) {
    const params = parsed.columns.map((c) => c.values.slice(start, start + BATCH_SIZE));
    await client.query(sql, params);
  }
  await client.query(
    'INSERT INTO upload_batches (dataset, file_name, row_count, meta, uploaded_by, period) VALUES ($1, $2, $3, $4, $5, $6)',
    [parsed.dataset, fileName, parsed.rowCount, JSON.stringify(parsed.meta), userId, parsed.scope?.period ?? null]
  );
}

/** Removes a removable reference dataset (Cost Centers). */
export async function clearDataset(client: PoolClient, table: string, dataset: string, userId: number | null): Promise<void> {
  await client.query(`TRUNCATE TABLE ${table} RESTART IDENTITY`);
  await client.query(
    'INSERT INTO upload_batches (dataset, file_name, row_count, meta, uploaded_by) VALUES ($1, NULL, 0, $2, $3)',
    [dataset, JSON.stringify({ removed: true }), userId]
  );
}

/** Removes one month's data for a month-based dataset. Refused if the month is locked. */
export async function clearMonthData(client: PoolClient, dataset: keyof typeof MONTHLY_DATASETS, monthName: string, userId: number | null): Promise<void> {
  const month = findMonth(monthName);
  if (!month) throw new Error('Unknown month');
  await lockPeriodForWrite(client, month);
  await deleteMonthRows(client, dataset, month);
  await client.query(
    'INSERT INTO upload_batches (dataset, file_name, row_count, meta, uploaded_by, period) VALUES ($1, NULL, 0, $2, $3, $4)',
    [dataset, JSON.stringify({ removed: true, month: month.month }), userId, month.period]
  );
}

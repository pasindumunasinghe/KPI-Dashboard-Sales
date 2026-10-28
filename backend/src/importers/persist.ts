import type { PoolClient } from 'pg';
import type { ParsedUpload } from './parse';

const BATCH_SIZE = 10000;

/**
 * Replaces the contents of the dataset's table with the parsed rows (each upload
 * replaces the previous file, as in the original app) and records an audit row.
 * Must be called inside a transaction.
 */
export async function persistUpload(
  client: PoolClient,
  parsed: ParsedUpload,
  fileName: string,
  userId: number | null
): Promise<void> {
  // Table and column names come from our own parsers, never from user input.
  await client.query(`TRUNCATE TABLE ${parsed.table} RESTART IDENTITY`);
  const names = parsed.columns.map((c) => c.name);
  const unnestArgs = parsed.columns.map((c, i) => `$${i + 1}::${c.type}[]`).join(', ');
  const sql = `INSERT INTO ${parsed.table} (${names.join(', ')}) SELECT * FROM unnest(${unnestArgs})`;
  for (let start = 0; start < parsed.rowCount; start += BATCH_SIZE) {
    const params = parsed.columns.map((c) => c.values.slice(start, start + BATCH_SIZE));
    await client.query(sql, params);
  }
  await client.query(
    'INSERT INTO upload_batches (dataset, file_name, row_count, meta, uploaded_by) VALUES ($1, $2, $3, $4, $5)',
    [parsed.dataset, fileName, parsed.rowCount, JSON.stringify(parsed.meta), userId]
  );
}

export async function clearDataset(client: PoolClient, table: string, dataset: string, userId: number | null): Promise<void> {
  await client.query(`TRUNCATE TABLE ${table} RESTART IDENTITY`);
  await client.query(
    'INSERT INTO upload_batches (dataset, file_name, row_count, meta, uploaded_by) VALUES ($1, $2, 0, $3, $4)',
    [dataset, null, JSON.stringify({ removed: true }), userId]
  );
}

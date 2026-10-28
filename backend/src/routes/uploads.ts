import path from 'path';
import { Router } from 'express';
import multer from 'multer';
import { config } from '../config';
import { pool } from '../db/pool';
import { requireAuth, requireRole } from '../middleware/auth';
import { findMonth } from '../fiscal';
import { DATASET_KEYS, UploadError, type DatasetKey } from '../importers/parse';
import { isMonthly } from '../importers/monthly';
import { parseInWorker } from '../importers/runParse';
import { clearDataset, clearMonthData, persistUpload } from '../importers/persist';
import { dataStore } from '../services/dataStore';
import { isPeriodLocked } from '../services/periods';
import { computeCostCenterValidation } from '../services/validation';

export const uploadsRouter = Router();
uploadsRouter.use(requireAuth);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxUploadMb * 1024 * 1024 } });

const CSV_ALLOWED: DatasetKey[] = ['debtor', 'inventory', 'distExclusion'];
const REMOVABLE: Partial<Record<DatasetKey, string>> = { costCenters: 'cost_centers' };

function isDataset(value: string): value is DatasetKey {
  return (DATASET_KEYS as readonly string[]).includes(value);
}

// Status of every upload slot (latest batch per dataset).
uploadsRouter.get('/', async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT DISTINCT ON (b.dataset) b.dataset, b.file_name, b.row_count, b.meta, b.uploaded_at, u.name AS uploaded_by
       FROM upload_batches b LEFT JOIN users u ON u.id = b.uploaded_by
      WHERE b.period IS NULL
      ORDER BY b.dataset, b.uploaded_at DESC, b.id DESC`
  );
  const datasets: Record<string, unknown> = {};
  for (const r of rows) {
    datasets[r.dataset] = {
      fileName: r.file_name,
      rowCount: r.row_count,
      uploadedAt: (r.uploaded_at as Date).toISOString(),
      uploadedBy: r.uploaded_by,
      removed: !!r.meta?.removed,
      meta: r.meta
    };
  }
  const ctx = await dataStore.get();
  res.json({ datasets, costCenterValidation: computeCostCenterValidation(ctx) });
});

uploadsRouter.post('/:dataset', requireRole('admin', 'finance'), upload.single('file'), async (req, res) => {
  const dataset = String(req.params.dataset);
  if (!isDataset(dataset)) {
    res.status(404).json({ error: 'Unknown dataset.' });
    return;
  }
  const file = req.file;
  if (!file) {
    res.status(400).json({ error: 'No file was uploaded.' });
    return;
  }
  const ext = path.extname(file.originalname).toLowerCase();
  const allowed = CSV_ALLOWED.includes(dataset) ? ['.xlsx', '.xls', '.csv'] : ['.xlsx', '.xls'];
  if (!allowed.includes(ext)) {
    res.status(422).json({ error: `Unsupported file type. Please upload a ${allowed.map((e) => e.slice(1).toUpperCase()).join(' / ')} file.` });
    return;
  }

  // Month-based datasets are uploaded for one chosen month; a locked month accepts nothing.
  let scope;
  if (isMonthly(dataset)) {
    const month = findMonth(req.query.month);
    if (!month) {
      res.status(400).json({ error: 'Select the month this file belongs to before uploading.' });
      return;
    }
    if (await isPeriodLocked(month.period)) {
      res.status(423).json({ error: `${month.label} is locked. An administrator must unlock it before data can be uploaded.`, locked: true });
      return;
    }
    scope = month;
  }

  try {
    const parsed = await parseInWorker(dataset, file.buffer, scope);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await persistUpload(client, parsed, file.originalname, req.user!.id);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
    dataStore.invalidate(dataset);
    const ctx = await dataStore.get();
    res.status(201).json({
      dataset,
      fileName: file.originalname,
      month: scope?.month ?? null,
      rowCount: parsed.rowCount,
      preview: { header: parsed.previewHeader, rows: parsed.previewRows },
      meta: parsed.meta,
      costCenterValidation: computeCostCenterValidation(ctx)
    });
  } catch (err) {
    if (err instanceof UploadError) {
      res.status(422).json({ error: err.message, missing: err.missing });
      return;
    }
    throw err;
  }
});

uploadsRouter.delete('/:dataset', requireRole('admin', 'finance'), async (req, res) => {
  const dataset = String(req.params.dataset);
  if (!isDataset(dataset)) {
    res.status(404).json({ error: 'Unknown dataset.' });
    return;
  }
  const monthly = isMonthly(dataset);
  if (!monthly && !REMOVABLE[dataset]) {
    res.status(400).json({ error: 'This dataset cannot be removed.' });
    return;
  }
  const month = monthly ? findMonth(req.query.month) : undefined;
  if (monthly && !month) {
    res.status(400).json({ error: 'Select the month whose data should be removed.' });
    return;
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (monthly) await clearMonthData(client, dataset, month!.month, req.user!.id);
    else await clearDataset(client, REMOVABLE[dataset]!, dataset, req.user!.id);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  dataStore.invalidate(dataset);
  res.json({ ok: true });
});

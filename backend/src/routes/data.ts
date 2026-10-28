import { Router } from 'express';
import { z } from 'zod';
import { DashboardCalc as Calc } from '../calc/calc';
import { requireAuth, requireRole } from '../middleware/auth';
import { getDashboard } from '../services/dashboard';
import { getComparison, getYtd } from '../services/comparison';
import { deleteSnapshot, listSnapshots, saveSnapshot } from '../services/snapshots';
import { getSettings, updateSettings } from '../services/settings';
import { dataStore } from '../services/dataStore';

export const dataRouter = Router();
dataRouter.use(requireAuth);

const MONTHS: string[] = Calc.MONTHS;
const monthOrAll = z.string().refine((v) => v === 'ALL' || MONTHS.includes(v), 'Invalid month');
const pctParam = (fallback: number) =>
  z
    .string()
    .optional()
    .transform((v) => {
      const n = v === undefined ? NaN : parseFloat(v);
      return Number.isFinite(n) ? n : v === undefined ? fallback : 0;
    });

const dashboardQuery = z.object({
  month: monthOrAll.default('ALL'),
  main: z.string().default('ALL'),
  sub: z.string().default('ALL'),
  gp: pctParam(20),
  npat: pctParam(10)
});

dataRouter.get('/dashboard', async (req, res) => {
  const q = dashboardQuery.safeParse(req.query);
  if (!q.success) {
    res.status(400).json({ error: 'Invalid filters.' });
    return;
  }
  res.json(
    await getDashboard({ month: q.data.month, mainChannel: q.data.main, subChannel: q.data.sub, gpTargetPct: q.data.gp, npatTargetPct: q.data.npat })
  );
});

const optionalMonth = z.string().optional();

dataRouter.get('/comparison', async (req, res) => {
  const { current, prev } = z.object({ current: optionalMonth, prev: optionalMonth }).parse(req.query);
  res.json(await getComparison(current, prev));
});

dataRouter.get('/ytd', async (req, res) => {
  const { current, comparison } = z.object({ current: optionalMonth, comparison: optionalMonth }).parse(req.query);
  res.json(await getYtd(current, comparison));
});

// Snapshots ---------------------------------------------------------------
dataRouter.get('/snapshots', async (_req, res) => {
  res.json({ snapshots: await listSnapshots() });
});

const snapshotBody = z.object({
  month: z.string().refine((v) => MONTHS.includes(v), 'Select a specific month'),
  mode: z.enum(['replace', 'new_version']).default('replace'),
  gp: z.number().default(20),
  npat: z.number().default(10)
});

dataRouter.post('/snapshots', requireRole('admin', 'finance'), async (req, res) => {
  const body = snapshotBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: 'Select a specific Month (not "All Months") before saving a snapshot.' });
    return;
  }
  const snapshot = await saveSnapshot(
    { month: body.data.month, mode: body.data.mode, gpTargetPct: body.data.gp, npatTargetPct: body.data.npat },
    req.user!.id
  );
  res.status(201).json({ snapshot });
});

dataRouter.delete('/snapshots/:id', requireRole('admin', 'finance'), async (req, res) => {
  const ok = await deleteSnapshot(Number(req.params.id));
  if (!ok) {
    res.status(404).json({ error: 'Snapshot not found.' });
    return;
  }
  res.json({ ok: true });
});

// Settings ----------------------------------------------------------------
dataRouter.get('/settings', async (_req, res) => {
  res.json({ settings: await getSettings() });
});

const settingsBody = z.object({
  mm60SurchargePct: z.number().finite().optional(),
  vk13ExchangeRates: z
    .array(z.object({ currency: z.string().trim().toUpperCase(), rate: z.union([z.string(), z.number()]).transform((v) => String(v)) }))
    .optional()
});

dataRouter.put('/settings', requireRole('admin', 'finance'), async (req, res) => {
  const body = settingsBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: 'Invalid settings.' });
    return;
  }
  const settings = await updateSettings(body.data, req.user!.id);
  dataStore.invalidate(); // settings feed COGS / allocation, so rebuild the dataset
  res.json({ settings });
});

import { Router } from 'express';
import { z } from 'zod';
import { FINANCIAL_YEAR_LABEL, findMonth } from '../fiscal';
import { requireAuth, requireRole } from '../middleware/auth';
import { MONTHLY_DATASETS } from '../importers/monthly';
import { fetchMonthRates, getMonthRates, setMonthRate } from '../services/fxRates';
import { listPeriods, lockPeriod, setElectricianPoint, unlockPeriod } from '../services/periods';

export const periodsRouter = Router();
periodsRouter.use(requireAuth);

const monthParam = (value: unknown) => findMonth(decodeURIComponent(String(value)))?.month;

// Status of every financial-year month: lock state, per-dataset row counts, electrician point.
periodsRouter.get('/', async (_req, res) => {
  res.json({
    financialYear: FINANCIAL_YEAR_LABEL,
    monthlyDatasets: Object.fromEntries(Object.entries(MONTHLY_DATASETS).map(([k, v]) => [k, v.label])),
    periods: await listPeriods()
  });
});

periodsRouter.post('/:month/lock', requireRole('admin', 'finance'), async (req, res) => {
  const month = monthParam(req.params.month);
  if (!month) {
    res.status(404).json({ error: 'Unknown month.' });
    return;
  }
  await lockPeriod(month, req.user!.id);
  res.json({ ok: true });
});

// Only an administrator can reopen a locked month.
periodsRouter.post('/:month/unlock', requireRole('admin'), async (req, res) => {
  const month = monthParam(req.params.month);
  if (!month) {
    res.status(404).json({ error: 'Unknown month.' });
    return;
  }
  const body = z.object({ note: z.string().trim().max(500).optional() }).safeParse(req.body ?? {});
  await unlockPeriod(month, req.user!.id, body.success ? body.data.note || null : null);
  res.json({ ok: true });
});

// Month-end exchange rates: CBSL indicative rates from Frankfurter, with manual overrides.
periodsRouter.get('/:month/fx-rates', async (req, res) => {
  const month = monthParam(req.params.month);
  if (!month) {
    res.status(404).json({ error: 'Unknown month.' });
    return;
  }
  res.json(await getMonthRates(month));
});

periodsRouter.post('/:month/fx-rates/fetch', requireRole('admin', 'finance'), async (req, res) => {
  const month = monthParam(req.params.month);
  if (!month) {
    res.status(404).json({ error: 'Unknown month.' });
    return;
  }
  const { missing } = await fetchMonthRates(month, req.user!.id);
  res.json({ ...(await getMonthRates(month)), missing });
});

periodsRouter.put('/:month/fx-rates/:currency', requireRole('admin', 'finance'), async (req, res) => {
  const month = monthParam(req.params.month);
  const body = z.object({ rate: z.number().finite().positive().nullable() }).safeParse(req.body);
  if (!month || !body.success) {
    res.status(400).json({ error: 'Provide a valid month and a positive rate (or null to use the CBSL rate).' });
    return;
  }
  await setMonthRate(month, String(req.params.currency), body.data.rate, req.user!.id);
  res.json(await getMonthRates(month));
});

periodsRouter.put('/:month/electrician-point', requireRole('admin', 'finance'), async (req, res) => {
  const month = monthParam(req.params.month);
  const body = z.object({ value: z.number().finite().min(0) }).safeParse(req.body);
  if (!month || !body.success) {
    res.status(400).json({ error: 'Provide a valid month and a non-negative amount.' });
    return;
  }
  await setElectricianPoint(month, body.data.value);
  res.json({ ok: true });
});

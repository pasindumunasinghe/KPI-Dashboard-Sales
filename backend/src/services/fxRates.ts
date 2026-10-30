import { pool } from '../db/pool';
import { findMonth, type FiscalMonth } from '../fiscal';
import { fetchCbslRates } from './frankfurter';
import { dataStore } from './dataStore';
import { PeriodStateError, lockPeriodForWrite, withTransaction } from './periods';
import { getSettings, type ExchangeRate } from './settings';

export interface MonthFxRate {
  currency: string;
  /** Rate the calculations use for this month (null: none, so VK13 prices in it are taken as LKR). */
  rate: number | null;
  /**
   * cbsl = CBSL indicative rate, manual = user override, default = no month rate (settings default),
   * none = a VK13 currency with no month or default rate.
   */
  source: 'cbsl' | 'manual' | 'default' | 'none';
  defaultRate: number | null;
  /** The uploaded VK13 prices use this currency. */
  inVk13: boolean;
  cbslRate: number | null;
  /** Date CBSL published `cbslRate` (the month-end, or the last business day before it). */
  rateDate: string | null;
  updatedBy: string | null;
  updatedAt: string | null;
}

export interface MonthFxRates {
  month: string;
  label: string;
  /** Last day of the month: the date whose CBSL rate is fetched. */
  monthEnd: string;
  rates: MonthFxRate[];
}

const lastDayOf = (m: FiscalMonth) => {
  const d = new Date(`${m.to}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};

const normCode = (c: string) => String(c || '').trim().toUpperCase();

function requireMonth(monthName: string): FiscalMonth {
  const month = findMonth(monthName);
  if (!month) throw new PeriodStateError('Unknown month.', 422);
  return month;
}

/** Currencies the uploaded VK13 prices are in, excluding LKR. */
async function vk13Currencies(): Promise<string[]> {
  const { rows } = await pool.query(
    `SELECT DISTINCT upper(trim(currency)) AS c FROM vk13_pricing WHERE currency IS NOT NULL AND trim(currency) NOT IN ('', 'LKR') ORDER BY 1`
  );
  return rows.map((r) => r.c as string).filter((c) => c !== 'LKR');
}

/** Currencies with a default rate in settings (LKR needs no conversion). */
function defaultRateMap(defaults: ExchangeRate[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const d of defaults) {
    const code = normCode(d.currency);
    if (code && code !== 'LKR') map.set(code, Number(d.rate) || 0);
  }
  return map;
}

export async function getMonthRates(monthName: string): Promise<MonthFxRates> {
  const month = requireMonth(monthName);
  const [settings, vk13, { rows }] = await Promise.all([
    getSettings(),
    vk13Currencies(),
    pool.query(
      `SELECT r.currency, r.rate, r.source, r.cbsl_rate, r.rate_date::text AS rate_date, r.updated_at, u.name AS updated_by
         FROM period_fx_rates r LEFT JOIN users u ON u.id = r.updated_by
        WHERE r.period = $1`,
      [month.period]
    )
  ]);
  const defaults = defaultRateMap(settings.vk13ExchangeRates);
  const stored = new Map(rows.map((r) => [r.currency as string, r]));
  const currencies = [...new Set([...vk13, ...defaults.keys(), ...stored.keys()])];
  return {
    month: month.month,
    label: month.label,
    monthEnd: lastDayOf(month),
    rates: currencies.map((currency) => {
      const r = stored.get(currency);
      const defaultRate = defaults.get(currency) ?? null;
      return {
        currency,
        rate: r ? Number(r.rate) : defaultRate,
        source: r ? r.source : defaultRate !== null ? 'default' : 'none',
        defaultRate,
        inVk13: vk13.includes(currency),
        cbslRate: r?.cbsl_rate != null ? Number(r.cbsl_rate) : null,
        rateDate: r?.rate_date ?? null,
        updatedBy: r?.updated_by ?? null,
        updatedAt: r ? (r.updated_at as Date).toISOString() : null
      };
    })
  };
}

/**
 * Fetches the CBSL indicative rates for the month-end and stores them for every currency the
 * VK13 prices use, plus any with a default rate. Manual overrides are kept; only their CBSL
 * reference is updated.
 */
export async function fetchMonthRates(monthName: string, userId: number): Promise<{ missing: string[] }> {
  const month = requireMonth(monthName);
  const monthEnd = lastDayOf(month);
  if (monthEnd > new Date().toISOString().slice(0, 10)) {
    throw new PeriodStateError(`The month-end rate for ${month.label} is available from ${monthEnd}.`, 422);
  }
  const [settings, vk13] = await Promise.all([getSettings(), vk13Currencies()]);
  const currencies = [...new Set([...vk13, ...defaultRateMap(settings.vk13ExchangeRates).keys()])];
  if (!currencies.length) {
    throw new PeriodStateError('No foreign currencies to fetch: upload VK13 (or add a currency to the default exchange rates) first.', 422);
  }

  // Call the API before taking the month's row lock.
  const fetched = await fetchCbslRates(currencies, monthEnd);
  const missing = currencies.filter((c) => !fetched.has(c));

  await withTransaction(async (client) => {
    await lockPeriodForWrite(client, month);
    for (const currency of currencies) {
      const cbsl = fetched.get(currency);
      if (!cbsl) continue;
      await client.query(
        `INSERT INTO period_fx_rates (period, currency, rate, source, cbsl_rate, rate_date, fetched_at, updated_by, updated_at)
         VALUES ($1, $2, $3, 'cbsl', $3, $4, now(), $5, now())
         ON CONFLICT (period, currency) DO UPDATE SET
           cbsl_rate = EXCLUDED.cbsl_rate,
           rate_date = EXCLUDED.rate_date,
           fetched_at = now(),
           rate = CASE WHEN period_fx_rates.source = 'manual' THEN period_fx_rates.rate ELSE EXCLUDED.rate END,
           updated_by = CASE WHEN period_fx_rates.source = 'manual' THEN period_fx_rates.updated_by ELSE EXCLUDED.updated_by END,
           updated_at = CASE WHEN period_fx_rates.source = 'manual' THEN period_fx_rates.updated_at ELSE now() END`,
        [month.period, currency, cbsl.rate, cbsl.rateDate, userId]
      );
    }
  });
  dataStore.invalidate();
  return { missing };
}

/**
 * Sets a manual rate for one currency, or with `rate: null` drops the override:
 * back to the fetched CBSL rate if there is one, otherwise to the default rate.
 */
export async function setMonthRate(monthName: string, currencyInput: string, rate: number | null, userId: number): Promise<void> {
  const month = requireMonth(monthName);
  const currency = normCode(currencyInput);
  if (!currency || currency === 'LKR') throw new PeriodStateError('Unknown currency.', 422);
  await withTransaction(async (client) => {
    await lockPeriodForWrite(client, month);
    if (rate !== null) {
      await client.query(
        `INSERT INTO period_fx_rates (period, currency, rate, source, updated_by, updated_at)
         VALUES ($1, $2, $3, 'manual', $4, now())
         ON CONFLICT (period, currency) DO UPDATE SET rate = EXCLUDED.rate, source = 'manual', updated_by = EXCLUDED.updated_by, updated_at = now()`,
        [month.period, currency, rate, userId]
      );
      return;
    }
    await client.query('DELETE FROM period_fx_rates WHERE period = $1 AND currency = $2 AND cbsl_rate IS NULL', [month.period, currency]);
    await client.query(
      `UPDATE period_fx_rates SET rate = cbsl_rate, source = 'cbsl', updated_by = $3, updated_at = now()
        WHERE period = $1 AND currency = $2 AND cbsl_rate IS NOT NULL`,
      [month.period, currency, userId]
    );
  });
  dataStore.invalidate();
}


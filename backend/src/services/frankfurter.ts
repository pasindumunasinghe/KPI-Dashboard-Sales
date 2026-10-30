const RATES_URL = 'https://api.frankfurter.dev/v2/rates';

/** Raised when CBSL rates can't be fetched; the message is safe to show to the user (HTTP 502). */
export class FxFetchError extends Error {
  constructor(message: string, public status: 502 | 503 = 502) {
    super(message);
    this.name = 'FxFetchError';
  }
}

export interface CbslRate {
  /** LKR per 1 unit of the currency. */
  rate: number;
  /** Date CBSL published the rate (on or before the requested date). */
  rateDate: string;
}

const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** One currency's CBSL indicative rate in force on `date`, or null if CBSL doesn't publish it. */
async function fetchOne(currency: string, date: string): Promise<CbslRate | null> {
  const url = `${RATES_URL}?date=${date}&base=${encodeURIComponent(currency)}&quotes=LKR&providers=cbsl`;
  let res: Response;
  try {
    res = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
  } catch {
    throw new FxFetchError('Could not reach the exchange rate service (Frankfurter). Try again later or enter the rates by hand.');
  }
  if (res.status === 404 || res.status === 422) return null; // currency not published by CBSL
  if (!res.ok) throw new FxFetchError(`The exchange rate service returned an error (HTTP ${res.status}). Try again later or enter the rates by hand.`);
  const body = (await res.json().catch(() => null)) as Array<{ date?: string; quote?: string; rate?: number }> | null;
  const row = Array.isArray(body) ? body.find((r) => String(r.quote).toUpperCase() === 'LKR') : undefined;
  if (!row) return null;
  const rate = Number(row.rate);
  const rateDate = String(row.date || '').slice(0, 10);
  // Weekends and holidays fall back to the last published day; anything older than a week is not a month-end rate.
  if (!(rate > 0) || !rateDate || rateDate > date || rateDate < addDays(date, -7)) return null;
  return { rate, rateDate };
}

/**
 * CBSL indicative rates (LKR per unit) in force on `date` for each currency, via the free
 * Frankfurter API. Currencies CBSL doesn't publish are left out of the result.
 */
export async function fetchCbslRates(currencies: string[], date: string): Promise<Map<string, CbslRate>> {
  const results = await Promise.all(currencies.map(async (c) => [c, await fetchOne(c, date)] as const));
  return new Map(results.filter((r): r is readonly [string, CbslRate] => r[1] !== null));
}

import { pool } from '../db/pool';

export interface ExchangeRate {
  currency: string;
  rate: string;
}

export interface AppSettings {
  mm60SurchargePct: number;
  vk13ExchangeRates: ExchangeRate[];
  electricianPoint: number;
}

export const DEFAULT_SETTINGS: AppSettings = {
  mm60SurchargePct: 0,
  vk13ExchangeRates: [
    { currency: 'USD', rate: '320.00' },
    { currency: 'EUR', rate: '350.00' },
    { currency: 'GBP', rate: '410.00' },
    { currency: 'JPY', rate: '2.15' },
    { currency: 'CNY', rate: '45.00' }
  ],
  electricianPoint: 0
};

const KEYS: Record<keyof AppSettings, string> = {
  mm60SurchargePct: 'mm60_surcharge_pct',
  vk13ExchangeRates: 'vk13_exchange_rates',
  electricianPoint: 'electrician_point'
};

export async function getSettings(): Promise<AppSettings> {
  const { rows } = await pool.query('SELECT key, value FROM settings');
  const byKey = new Map<string, unknown>(rows.map((r) => [r.key as string, r.value]));
  return {
    mm60SurchargePct: (byKey.get(KEYS.mm60SurchargePct) as number | undefined) ?? DEFAULT_SETTINGS.mm60SurchargePct,
    vk13ExchangeRates: (byKey.get(KEYS.vk13ExchangeRates) as ExchangeRate[] | undefined) ?? DEFAULT_SETTINGS.vk13ExchangeRates,
    electricianPoint: (byKey.get(KEYS.electricianPoint) as number | undefined) ?? DEFAULT_SETTINGS.electricianPoint
  };
}

export async function updateSettings(patch: Partial<AppSettings>, userId: number | null): Promise<AppSettings> {
  for (const name of Object.keys(patch) as Array<keyof AppSettings>) {
    const value = patch[name];
    if (value === undefined) continue;
    await pool.query(
      `INSERT INTO settings (key, value, updated_by) VALUES ($1, $2::jsonb, $3)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = EXCLUDED.updated_by`,
      [KEYS[name], JSON.stringify(value), userId]
    );
  }
  return getSettings();
}

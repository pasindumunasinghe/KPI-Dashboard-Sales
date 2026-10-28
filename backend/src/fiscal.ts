import { config } from './config';

/** Financial-year months in order (April -> March), matching the calculation engine. */
export const FISCAL_MONTHS = ['April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December', 'January', 'February', 'March'] as const;

export interface FiscalMonth {
  /** Month name as used across the app, e.g. "June". */
  month: string;
  /** Calendar period key, e.g. "2026-06". */
  period: string;
  /** Inclusive first day (YYYY-MM-DD). */
  from: string;
  /** Exclusive end: first day of the following month (YYYY-MM-DD). */
  to: string;
  /** Human label, e.g. "June 2026". */
  label: string;
}

const pad = (n: number) => String(n).padStart(2, '0');
const startYear = config.fiscalYearStart;

export const FINANCIAL_YEAR_LABEL = `FY${pad(startYear % 100)}/${pad((startYear + 1) % 100)}`;

const ALL: FiscalMonth[] = FISCAL_MONTHS.map((month, i) => {
  const calMonth0 = (3 + i) % 12; // April = 3
  const year = startYear + (i >= 9 ? 1 : 0); // Jan-Mar fall in the next calendar year
  const nextYear = calMonth0 === 11 ? year + 1 : year;
  const nextMonth1 = calMonth0 === 11 ? 1 : calMonth0 + 2;
  return {
    month,
    period: `${year}-${pad(calMonth0 + 1)}`,
    from: `${year}-${pad(calMonth0 + 1)}-01`,
    to: `${nextYear}-${pad(nextMonth1)}-01`,
    label: `${month} ${year}`
  };
});

export function fiscalMonths(): FiscalMonth[] {
  return ALL;
}

export function findMonth(month: unknown): FiscalMonth | undefined {
  return ALL.find((m) => m.month === month);
}

/** "2026-06" -> "June" (null when the period is outside the financial year). */
export function periodToMonth(period: string | null | undefined): string | null {
  return ALL.find((m) => m.period === period)?.month ?? null;
}

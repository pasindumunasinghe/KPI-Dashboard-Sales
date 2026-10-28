/**
 * Datasets that are uploaded month by month. Everything else (Target, G/L, MM60,
 * VK13, Cost Centers, Exclusion list) is reference data and is not month-specific.
 * To change which datasets are month-based, edit this map (and the lock trigger
 * migration if a new table is added).
 */
export const MONTHLY_DATASETS = {
  sales: { table: 'sales_rows', kind: 'date', column: 'billing_date', label: 'Sales Report' },
  expenses: { table: 'expense_rows', kind: 'date', column: 'posting_date', label: 'Expenses Report' },
  debtor: { table: 'debtor_rows', kind: 'period', column: 'period', label: 'Debtor Summary Report' },
  inventory: { table: 'inventory_rows', kind: 'period', column: 'period', label: 'Inventory Report' }
} as const;

export type MonthlyDataset = keyof typeof MONTHLY_DATASETS;

export const MONTHLY_KEYS = Object.keys(MONTHLY_DATASETS) as MonthlyDataset[];

export function isMonthly(dataset: string): dataset is MonthlyDataset {
  return dataset in MONTHLY_DATASETS;
}

/** Datasets a month must have before it can be locked. */
export const REQUIRED_FOR_LOCK: MonthlyDataset[] = ['sales', 'expenses'];

import { DashboardCalc as Calc } from '../calc/calc';
import { pool } from '../db/pool';
import { computeAllocation } from './allocation';
import { dataStore } from './dataStore';
import { listPeriods } from './periods';

export interface DashboardQuery {
  month: string;
  mainChannel: string;
  subChannel: string;
  gpTargetPct: number;
  npatTargetPct: number;
}

export interface BreakdownRow {
  glAccount: string;
  description: string;
  amount: number;
}

const EXPENSE_BREAKDOWN_CATEGORIES = {
  spi: 'Sales Performance Incentives',
  gee: 'General Employee Expenses',
  admin: 'Administration Expenses',
  other: 'Other Expenses',
  badDebt: 'Bad Debtor Provision'
} as const;

/** Reference datasets (not month-specific) the KPIs cannot be calculated without. */
const REQUIRED_REFERENCE = ['target', 'gl', 'mm60', 'vk13'] as const;
/** Month-based datasets every month needs to produce meaningful results. */
const REQUIRED_MONTHLY = ['sales', 'expenses'] as const;

async function getMissingReference(): Promise<string[]> {
  const { rows } = await pool.query(
    `SELECT DISTINCT ON (dataset) dataset, row_count FROM upload_batches WHERE period IS NULL ORDER BY dataset, uploaded_at DESC, id DESC`
  );
  const loaded = new Set(rows.filter((r) => r.row_count > 0).map((r) => r.dataset as string));
  return REQUIRED_REFERENCE.filter((d) => !loaded.has(d));
}

export async function getDashboard(q: DashboardQuery) {
  const { dataset, files, settings, electricianByMonth, lastUpdated } = await dataStore.get();
  const periods = await listPeriods();

  const ctx = { dataset, files, settings, electricianByMonth, lastUpdated };
  const allocation = computeAllocation(ctx, { month: q.month, mainChannel: q.mainChannel, subChannel: q.subChannel });

  const kpis = Calc.computeKPIs(dataset, {
    month: q.month,
    mainChannel: q.mainChannel,
    subChannel: q.subChannel,
    gpTargetPct: q.gpTargetPct,
    npatTargetPct: q.npatTargetPct,
    warehouseCostAllocated: allocation.totalWarehouseAllocated,
    distributionCostAllocated: allocation.totalDistributionAllocated,
    electricianPointAllocated: allocation.totalElectricianPointAllocated,
    debtorInterestAllocated: allocation.totalDebtorInterest,
    inventoryInterestAllocated: allocation.totalInventoryInterestAllocated
  });

  const months: string[] = q.month === 'ALL' ? dataset.months : [q.month];
  const breakdown = (category: string, extraByGL?: Record<string, number>): BreakdownRow[] =>
    Calc.computeExpenseCategoryBreakdown(dataset, months, category, q.mainChannel, q.subChannel, extraByGL).rows;

  const breakdowns: Record<string, BreakdownRow[]> = {
    sd: breakdown('Selling & Distribution Expenses', {
      '680029': allocation.totalWarehouseAllocated + allocation.totalDistributionAllocated,
      '680008': allocation.totalElectricianPointAllocated
    }),
    financeCost: breakdown('Finance Cost', {
      '700004': allocation.totalDebtorInterest + allocation.totalInventoryInterestAllocated
    })
  };
  (Object.keys(EXPENSE_BREAKDOWN_CATEGORIES) as Array<keyof typeof EXPENSE_BREAKDOWN_CATEGORIES>).forEach((key) => {
    breakdowns[key] = breakdown(EXPENSE_BREAKDOWN_CATEGORIES[key]);
  });

  return {
    lastUpdated,
    missingDatasets: await getMissingReference(),
    // Month-based datasets with no data for the selected month (or for any month, on "All Months").
    missingForMonth: REQUIRED_MONTHLY.filter((key) =>
      q.month === 'ALL' ? periods.every((p) => !p.data[key].rowCount) : !periods.find((p) => p.month === q.month)?.data[key].rowCount
    ),
    monthStatus: Object.fromEntries(
      periods.map((p) => [
        p.month,
        { status: p.status, lockedAt: p.lockedAt, lockedBy: p.lockedBy, hasData: Object.values(p.data).some((d) => d.rowCount > 0) }
      ])
    ),
    options: { months: dataset.months as string[], mainChannels: dataset.mainChannels as Array<{ main: string; subs: string[] }> },
    costCentersLoaded: !!dataset.costCentersLoaded,
    kpis,
    allocation: {
      rows: allocation.rows.map((r: any) => ({
        code: r.code,
        label: r.label,
        primarySales: r.primarySales,
        warehouseAllocationPct: r.warehouseAllocationPct,
        warehouseCost: r.warehouseCost,
        distributionCost: r.distributionCost,
        debtorInterest: r.debtorInterest,
        electricianPoint: r.electricianPoint,
        inventoryInterest: r.inventoryInterest
      })),
      totals: {
        eligibleSales: allocation.totalEligibleSales,
        warehouse: allocation.totalWarehouseAllocated,
        distribution: allocation.totalDistributionAllocated,
        debtorInterest: allocation.totalDebtorInterest,
        electricianPoint: allocation.totalElectricianPointAllocated,
        inventoryInterest: allocation.totalInventoryInterestAllocated
      }
    },
    breakdowns
  };
}

import { DashboardCalc as Calc } from '../calc/calc';
import { dataStore } from './dataStore';

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

export async function getDashboard(q: DashboardQuery) {
  const { dataset, files, settings, lastUpdated } = await dataStore.get();

  const allocation = Calc.computeWarehouseDistributionAllocation(dataset, {
    month: q.month,
    mainChannel: q.mainChannel,
    subChannel: q.subChannel,
    distributorExclusionRows: files.distributorExclusionRows,
    debtorRows: files.debtorRows,
    electricianPointValue: settings.electricianPoint,
    inventoryRows: files.inventoryRows
  });

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

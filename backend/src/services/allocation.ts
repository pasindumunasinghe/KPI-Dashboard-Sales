import { DashboardCalc as Calc } from '../calc/calc';
import type { DataContext } from './dataStore';

type Rows = any[][];

/** Keeps the header plus the rows whose trailing "Month" column equals `month`. */
export function rowsForMonth(rows: Rows, month: string): Rows {
  if (!rows || rows.length < 2) return rows;
  const idx = rows[0].indexOf('Month');
  return [rows[0], ...rows.slice(1).filter((r) => r[idx] === month)];
}

export interface AllocationQuery {
  month: string; // a month name or 'ALL'
  mainChannel: string;
  subChannel: string;
}

/**
 * Warehouse / distribution / debtor / electrician / inventory allocation for the selected
 * month. Month-based inputs are taken from that month only; for "All Months" they are summed
 * across the months that have data (each month's electrician amount is split by that month's
 * own target %).
 */
export function computeAllocation(ctx: DataContext, q: AllocationQuery) {
  const { dataset, files, electricianByMonth } = ctx;
  const common = {
    mainChannel: q.mainChannel,
    subChannel: q.subChannel,
    distributorExclusionRows: files.distributorExclusionRows,
    inventoryRows: files.inventoryRows // already carries a Month column, which the engine filters on
  };

  if (q.month !== 'ALL') {
    return Calc.computeWarehouseDistributionAllocation(dataset, {
      ...common,
      month: q.month,
      debtorRows: rowsForMonth(files.debtorRows, q.month),
      electricianPointValue: electricianByMonth[q.month] || 0
    });
  }

  // Debtor interest is linear in the rows, so all months together = the sum of the monthly interests.
  const result = Calc.computeWarehouseDistributionAllocation(dataset, {
    ...common,
    month: 'ALL',
    debtorRows: files.debtorRows,
    electricianPointValue: 0
  });
  for (const [month, value] of Object.entries(electricianByMonth)) {
    if (!value) continue;
    const part = Calc.computeWarehouseDistributionAllocation(dataset, {
      month,
      mainChannel: 'ALL',
      subChannel: 'ALL',
      distributorExclusionRows: files.distributorExclusionRows,
      electricianPointValue: value
    });
    for (const row of result.rows) {
      const p = part.rows.find((r: any) => r.label === row.label);
      if (p) row.electricianPoint += p.electricianPoint;
    }
  }
  result.totalElectricianPointAllocated = result.rows.reduce((sum: number, r: any) => sum + r.electricianPoint, 0);
  return result;
}

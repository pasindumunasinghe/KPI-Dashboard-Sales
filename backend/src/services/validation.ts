import { DashboardCalc as Calc } from '../calc/calc';
import type { DataContext } from './dataStore';

/** Cost-center match summary shown after a Cost Centers or Expenses upload. */
export function computeCostCenterValidation(ctx: DataContext) {
  const ccRows = ctx.files.costCenterRows;
  if (!ccRows || !ccRows.length) return null;
  const ccResult = Calc.buildCostCenterMap(ccRows);
  if (!ccResult.uniqueCount) return null;
  const match = Calc.matchCostCenterExpenses(ctx.files.expenseRows, ccResult, ['1100', '1600']);
  const unmatched = Object.keys(match.unmatchedCostCenters).sort();
  return {
    uniqueCount: ccResult.uniqueCount as number,
    validTransactionRows: match.validTransactionRows as number,
    matchedRows: match.matchedRows.length as number,
    matchedNetAmount: match.matchedNetAmount as number,
    unmatchedCount: unmatched.length,
    unmatchedList: unmatched
  };
}

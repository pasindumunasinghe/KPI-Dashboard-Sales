import { DashboardCalc as Calc } from '../calc/calc';
import { getLatestSnapshotsByMonth, type Snapshot } from './snapshots';

type Fmt = 'currency' | 'pct';

interface KpiDef {
  key: string;
  label: string;
  fmt: Fmt;
}

const MONTH_ORDER: string[] = Calc.MONTHS; // April..March (financial-year order)

const CARD_DEFS: KpiDef[] = [
  { key: 'primarySales', label: 'Primary Sales', fmt: 'currency' },
  { key: 'cogs', label: 'COGS', fmt: 'currency' },
  { key: 'grossProfit', label: 'Gross Profit', fmt: 'currency' },
  { key: 'grossProfitPct', label: 'Gross Profit Margin %', fmt: 'pct' },
  { key: 'ebit', label: 'EBIT', fmt: 'currency' },
  { key: 'npat', label: 'NPAT', fmt: 'currency' },
  { key: 'warehouseCost', label: 'Warehouse Cost', fmt: 'currency' },
  { key: 'distributionCost', label: 'Delivery Cost', fmt: 'currency' },
  { key: 'debtorInterest', label: 'Debtor Interest', fmt: 'currency' }
];

const YTD_KPI_DEFS: KpiDef[] = [
  { key: 'primarySales', label: 'Primary Sales', fmt: 'currency' },
  { key: 'cogs', label: 'COGS', fmt: 'currency' },
  { key: 'costOfSalesGL', label: 'Cost of Sales (G/L)', fmt: 'currency' },
  { key: 'grossProfit', label: 'Gross Profit', fmt: 'currency' },
  { key: 'grossProfitPct', label: 'Gross Profit %', fmt: 'pct' },
  { key: 'spi', label: 'Sales Performance Incentives', fmt: 'currency' },
  { key: 'gee', label: 'General Employee Expenses', fmt: 'currency' },
  { key: 'admin', label: 'Administration Expenses', fmt: 'currency' },
  { key: 'sd', label: 'Selling & Distribution Expenses', fmt: 'currency' },
  { key: 'other', label: 'Other Expenses', fmt: 'currency' },
  { key: 'badDebt', label: 'Bad Debtor Provision', fmt: 'currency' },
  { key: 'totalOperationExpenses', label: 'Total Operating Expenses', fmt: 'currency' },
  { key: 'ebit', label: 'EBIT', fmt: 'currency' },
  { key: 'ebitPct', label: 'EBIT %', fmt: 'pct' },
  { key: 'financeCost', label: 'Finance Cost', fmt: 'currency' },
  { key: 'npbt', label: 'NPBT', fmt: 'currency' },
  { key: 'npbtPct', label: 'NPBT %', fmt: 'pct' },
  { key: 'corporateTax', label: 'Corporate Tax', fmt: 'currency' },
  { key: 'npat', label: 'NPAT', fmt: 'currency' },
  { key: 'npatPct', label: 'NPAT %', fmt: 'pct' },
  { key: 'warehouseCost', label: 'Warehouse Cost', fmt: 'currency' },
  { key: 'distributionCost', label: 'Delivery Cost', fmt: 'currency' },
  { key: 'debtorInterest', label: 'Debtor Interest', fmt: 'currency' },
  { key: 'electricianPoint', label: 'Electrician Point', fmt: 'currency' },
  { key: 'inventoryInterest', label: 'Inventory Interest', fmt: 'currency' }
];

const YTD_SUM_KEYS = [
  'primarySales', 'cogs', 'costOfSalesGL', 'grossProfit', 'spi', 'gee', 'admin', 'sd', 'other', 'badDebt',
  'totalOperationExpenses', 'ebit', 'financeCost', 'npbt', 'corporateTax', 'npat',
  'warehouseCost', 'distributionCost', 'debtorInterest', 'electricianPoint', 'inventoryInterest'
];

interface Variance {
  variance: number | null;
  pct: number | null;
}

function variance(cur: number, prev: number | null | undefined): Variance {
  if (prev === undefined || prev === null) return { variance: null, pct: null };
  const v = cur - prev;
  const pct = prev !== 0 ? (v / Math.abs(prev)) * 100 : cur !== 0 ? 100 : 0;
  return { variance: v, pct };
}

function savedMonths(snaps: Map<string, Snapshot>): string[] {
  return MONTH_ORDER.filter((m) => snaps.has(m));
}

export async function getComparison(currentParam?: string, prevParam?: string) {
  const snaps = await getLatestSnapshotsByMonth();
  const monthOptions = savedMonths(snaps);
  const currentMonth = currentParam && snaps.has(currentParam) ? currentParam : monthOptions[monthOptions.length - 1] || null;

  let defaultPrev: string | null = null;
  if (currentMonth) {
    for (let i = MONTH_ORDER.indexOf(currentMonth) - 1; i >= 0; i--) {
      if (snaps.has(MONTH_ORDER[i])) {
        defaultPrev = MONTH_ORDER[i];
        break;
      }
    }
  }
  // undefined -> default previous month; '' -> explicitly none
  const prevMonth = prevParam === undefined ? defaultPrev || '' : snaps.has(prevParam) ? prevParam : '';

  const current = currentMonth ? snaps.get(currentMonth)! : null;
  const prev = prevMonth ? snaps.get(prevMonth) || null : null;
  const hasPrev = !!prev;

  const rows = (defs: KpiDef[]) =>
    defs.map((def) => {
      const cur = current ? current.kpis[def.key] : 0;
      const prv = prev ? prev.kpis[def.key] : null;
      return { key: def.key, label: def.label, fmt: def.fmt, current: cur, prev: hasPrev ? prv : null, ...variance(cur, hasPrev ? prv : null) };
    });

  const channels = current
    ? current.mainChannelBreakdown.map((row) => {
        const prevRow = prev ? prev.mainChannelBreakdown.find((r) => r.channel === row.channel) : null;
        const v = hasPrev && prevRow ? variance(row.sales, prevRow.sales) : { variance: null, pct: null };
        return { channel: row.channel, current: row.sales, prev: hasPrev ? (prevRow ? prevRow.sales : 0) : null, ...v };
      })
    : [];

  return {
    financialYear: 'FY26/27',
    monthOptions,
    currentMonth,
    prevMonth,
    hasAnySnapshots: monthOptions.length > 0,
    hasPrev,
    cards: rows(CARD_DEFS),
    table: rows(CARD_DEFS),
    channels,
    trend: monthOptions.map((m) => ({ month: m, primarySales: snaps.get(m)!.kpis.primarySales }))
  };
}

function sumYtd(snaps: Map<string, Snapshot>, month: string) {
  const idx = MONTH_ORDER.indexOf(month);
  const inRange = idx === -1 ? [] : MONTH_ORDER.slice(0, idx + 1);
  const covered: string[] = [];
  const missing: string[] = [];
  const totals: Record<string, number> = {};
  YTD_SUM_KEYS.forEach((k) => (totals[k] = 0));
  inRange.forEach((m) => {
    const snap = snaps.get(m);
    if (!snap) {
      missing.push(m);
      return;
    }
    covered.push(m);
    YTD_SUM_KEYS.forEach((k) => (totals[k] += snap.kpis[k] || 0));
  });
  const pct = (n: number) => (totals.primarySales ? (n / totals.primarySales) * 100 : 0);
  totals.grossProfitPct = pct(totals.grossProfit);
  totals.ebitPct = pct(totals.ebit);
  totals.npbtPct = pct(totals.npbt);
  totals.npatPct = pct(totals.npat);
  return { totals, covered, missing, hasAny: covered.length > 0 };
}

export async function getYtd(currentParam?: string, comparisonParam?: string) {
  const snaps = await getLatestSnapshotsByMonth();
  const monthOptions = savedMonths(snaps);
  const currentMonth = currentParam && snaps.has(currentParam) ? currentParam : monthOptions[monthOptions.length - 1] || '';
  const comparisonMonth = comparisonParam && snaps.has(comparisonParam) ? comparisonParam : '';

  const current = currentMonth ? sumYtd(snaps, currentMonth) : { totals: {} as Record<string, number>, covered: [], missing: [] as string[], hasAny: false };
  const comparison = comparisonMonth ? sumYtd(snaps, comparisonMonth) : { totals: {} as Record<string, number>, covered: [], missing: [] as string[], hasAny: false };
  const hasComparison = !!comparisonMonth && comparison.hasAny;
  const missing = Array.from(new Set([...current.missing, ...(hasComparison ? comparison.missing : [])]));

  const table = YTD_KPI_DEFS.map((def) => {
    const cur = current.totals[def.key] || 0;
    const prv = hasComparison ? comparison.totals[def.key] || 0 : null;
    return { key: def.key, label: def.label, fmt: def.fmt, current: cur, prev: prv, ...variance(cur, prv) };
  });

  return {
    financialYear: 'FY26/27',
    monthOptions,
    currentMonth,
    comparisonMonth,
    hasAnySnapshots: monthOptions.length > 0,
    hasComparison,
    missingMonths: missing,
    table,
    trend: monthOptions.map((m) => ({ month: m, primarySales: sumYtd(snaps, m).totals.primarySales || 0 }))
  };
}

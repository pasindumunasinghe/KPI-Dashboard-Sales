export type Role = 'admin' | 'finance' | 'viewer';

export interface User {
  id: number;
  email: string;
  name: string;
  role: Role;
}

export interface ManagedUser extends User {
  isActive: boolean;
  createdAt: string;
  lastLoginAt: string | null;
}

export interface Achievement {
  actual: number;
  target: number;
  achievementPct: number;
}

export interface Kpis {
  primarySales: Achievement;
  cogs: number;
  costOfSalesGL: number;
  costOfSalesTotal: number;
  grossProfit: number;
  grossProfitPct: Achievement;
  expenses: {
    spi: number;
    gee: number;
    totalEmployeeRelated: number;
    admin: number;
    sd: number;
    other: number;
    badDebt: number;
    totalOperationExpenses: number;
  };
  ebit: number;
  ebitPct: number;
  financeCost: number;
  npbt: number;
  npbtPct: number;
  corporateTax: number;
  npat: number;
  npatPct: Achievement;
}

export interface BreakdownRow {
  glAccount: string;
  description: string;
  amount: number;
}

export interface AllocationRow {
  code: string;
  label: string;
  primarySales: number;
  warehouseAllocationPct: number;
  warehouseCost: number;
  distributionCost: number;
  debtorInterest: number;
  electricianPoint: number;
  inventoryInterest: number;
}

export interface DashboardData {
  lastUpdated: string | null;
  missingDatasets: string[];
  options: { months: string[]; mainChannels: Array<{ main: string; subs: string[] }> };
  costCentersLoaded: boolean;
  kpis: Kpis;
  allocation: {
    rows: AllocationRow[];
    totals: {
      eligibleSales: number;
      warehouse: number;
      distribution: number;
      debtorInterest: number;
      electricianPoint: number;
      inventoryInterest: number;
    };
  };
  breakdowns: Record<'sd' | 'financeCost' | 'spi' | 'gee' | 'admin' | 'other' | 'badDebt', BreakdownRow[]>;
}

export interface DashboardParams {
  month: string;
  main: string;
  sub: string;
  gp: string;
  npat: string;
}

export interface CompareRow {
  key: string;
  label: string;
  fmt: 'currency' | 'pct';
  current: number;
  prev: number | null;
  variance: number | null;
  pct: number | null;
}

export interface ComparisonData {
  financialYear: string;
  monthOptions: string[];
  currentMonth: string | null;
  prevMonth: string;
  hasAnySnapshots: boolean;
  hasPrev: boolean;
  cards: CompareRow[];
  table: CompareRow[];
  channels: Array<{ channel: string; current: number; prev: number | null; variance: number | null; pct: number | null }>;
  trend: Array<{ month: string; primarySales: number }>;
}

export interface YtdData {
  financialYear: string;
  monthOptions: string[];
  currentMonth: string;
  comparisonMonth: string;
  hasAnySnapshots: boolean;
  hasComparison: boolean;
  missingMonths: string[];
  table: CompareRow[];
  trend: Array<{ month: string; primarySales: number }>;
}

export interface SnapshotSummary {
  id: number;
  financialYear: string;
  month: string;
  version: number;
  createdAt: string;
  createdBy: string | null;
}

export interface ExchangeRate {
  currency: string;
  rate: string;
}

export interface AppSettings {
  mm60SurchargePct: number;
  vk13ExchangeRates: ExchangeRate[];
  electricianPoint: number;
}

export interface CostCenterValidation {
  uniqueCount: number;
  validTransactionRows: number;
  matchedRows: number;
  matchedNetAmount: number;
  unmatchedCount: number;
  unmatchedList: string[];
}

export interface DatasetStatus {
  fileName: string | null;
  rowCount: number;
  uploadedAt: string;
  uploadedBy: string | null;
  removed: boolean;
  meta: Record<string, unknown>;
}

export interface UploadsStatus {
  datasets: Record<string, DatasetStatus>;
  costCenterValidation: CostCenterValidation | null;
}

export interface UploadResult {
  dataset: string;
  fileName: string;
  rowCount: number;
  preview: { header: string[]; rows: Array<Array<string | number>> };
  meta: Record<string, unknown>;
  costCenterValidation: CostCenterValidation | null;
}

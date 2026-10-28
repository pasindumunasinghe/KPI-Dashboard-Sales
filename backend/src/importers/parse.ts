import * as XLSX from 'xlsx';
import { DashboardCalc as Calc } from '../calc/calc';
import type { FiscalMonth } from '../fiscal';
import { isMonthly } from './monthly';

export const DATASET_KEYS = [
  'sales',
  'target',
  'expenses',
  'gl',
  'mm60',
  'vk13',
  'distExclusion',
  'costCenters',
  'debtor',
  'inventory'
] as const;
export type DatasetKey = (typeof DATASET_KEYS)[number];

export interface ParsedColumn {
  name: string;
  /** Postgres array element type used with unnest(), e.g. text, numeric, date */
  type: 'text' | 'numeric' | 'date' | 'integer';
  values: Array<string | number | null>;
}

/** The month a monthly dataset is being uploaded for. */
export type MonthScope = Pick<FiscalMonth, 'month' | 'period' | 'from' | 'to' | 'label'>;

export interface ParsedUpload {
  dataset: DatasetKey;
  table: string;
  columns: ParsedColumn[];
  rowCount: number;
  /** Set for month-based datasets: the period key the rows belong to. */
  scope?: MonthScope;
  previewHeader: string[];
  previewRows: Array<Array<string | number>>;
  meta: Record<string, unknown>;
}

/** Validation problem that should be shown to the person uploading the file. */
export class UploadError extends Error {
  missing?: string[];
  constructor(message: string, missing?: string[]) {
    super(message);
    this.name = 'UploadError';
    this.missing = missing;
  }
}

type Row = any[];

const REQUIRED_COLUMNS: Partial<Record<DatasetKey, string[]>> = {
  sales: ['Billing Date', 'Distribution Channel', 'Distribution Channel1', 'Bill-to Party', 'Sales Employee', 'Material', 'Plant', 'Qty', 'Sales Value'],
  target: ['Main Channel', 'Sub Channel', 'April', 'March'],
  expenses: ['Company Code', 'G/L Account', 'Posting Date', 'Amount in Local Currency'],
  gl: ['GL Category', 'GL Code'],
  mm60: ['Material', 'Plant', 'Price'],
  vk13: ['Material', 'Amount'],
  costCenters: ['Cost Center', 'Name', 'Description', 'Allocation Base', 'Allocated Channel'],
  debtor: ['Sales Channel']
};

const str = (v: unknown): string => (v === undefined || v === null ? '' : String(v).trim());

function readWorkbook(buffer: Uint8Array): XLSX.WorkBook {
  try {
    return XLSX.read(buffer, {
      type: 'buffer',
      cellDates: false,
      dense: true,
      cellFormula: false,
      cellHTML: false,
      cellStyles: false,
      cellNF: false,
      cellText: false
    });
  } catch {
    throw new UploadError('Could not read this file. Please check it is a valid .xlsx file and try again.');
  }
}

function sheetToRows(ws: XLSX.WorkSheet): Row[] {
  return XLSX.utils.sheet_to_json<Row>(ws, { header: 1, raw: true, defval: '' });
}

function firstSheetRows(wb: XLSX.WorkBook): Row[] {
  const name = wb.SheetNames[0];
  if (!name) throw new UploadError('The workbook contains no worksheets.');
  return sheetToRows(wb.Sheets[name]);
}

function assertColumns(dataset: DatasetKey, header: Row | undefined, label?: string): void {
  const required = REQUIRED_COLUMNS[dataset] || [];
  const present = new Set((header || []).map((h) => str(h).toLowerCase()));
  const missing = required.filter((c) => !present.has(c.toLowerCase()));
  if (missing.length) {
    throw new UploadError(
      `This file doesn't match the expected format${label ? ` for ${label}` : ''}. Missing column(s): ${missing.join(', ')}.`,
      missing
    );
  }
}

function preview(header: Row, rows: Row[]): { previewHeader: string[]; previewRows: Array<Array<string | number>> } {
  const clean = (v: unknown): string | number => (typeof v === 'number' ? v : str(v));
  const width = header.length;
  return {
    previewHeader: header.map((h) => str(h)),
    previewRows: rows.slice(0, 3).map((r) => Array.from({ length: width }, (_, i) => clean(r[i])))
  };
}

function isoDate(value: unknown): string | null {
  const d: Date | null = Calc.excelSerialToDate(value);
  if (!d || isNaN(d.getTime())) return null;
  const year = d.getUTCFullYear();
  if (year < 1990 || year > 2100) return null;
  return d.toISOString().slice(0, 10);
}

/** Min/max of ISO dates, used to explain why a file has nothing for the chosen month. */
function rangeText(dates: string[]): string {
  if (!dates.length) return '';
  const sorted = [...dates].sort();
  return ` The file's dates run from ${sorted[0]} to ${sorted[sorted.length - 1]}.`;
}

function colsFromRecords(spec: Array<[string, ParsedColumn['type']]>, records: Array<Array<string | number | null>>): ParsedColumn[] {
  return spec.map(([name, type], idx) => ({ name, type, values: records.map((r) => r[idx]) }));
}

// ---------------------------------------------------------------------------
// Per-dataset parsers. Each returns canonical, typed columns ready to be loaded
// into PostgreSQL. They reuse the same normalisation helpers as the original
// browser app (normalizeSalesRows, normalizeVK13Rows, ...), so uploads accept
// exactly the same raw SAP/BW exports as before.
// ---------------------------------------------------------------------------

function parseSales(wb: XLSX.WorkBook, scope: MonthScope): ParsedUpload {
  const canonical: Row[] = Calc.normalizeSalesRows(firstSheetRows(wb));
  assertColumns('sales', canonical[0], 'Sales Report');
  const hm = Calc.headerMap(canonical[0]);
  const records: Array<Array<string | number | null>> = [];
  let skipped = 0;
  let outside = 0;
  const seenDates: string[] = [];
  for (let i = 1; i < canonical.length; i++) {
    const r = canonical[i];
    if (!r || !r.length) continue;
    const date = isoDate(Calc.col(hm, r, 'Billing Date'));
    if (!date) {
      skipped++;
      continue;
    }
    seenDates.push(date);
    if (date < scope.from || date >= scope.to) {
      outside++;
      continue;
    }
    records.push([
      str(Calc.col(hm, r, 'Sales Organization')),
      date,
      str(Calc.col(hm, r, 'Billing Document')),
      str(Calc.col(hm, r, 'Billing Type')),
      str(Calc.col(hm, r, 'Bill-to Party')),
      str(Calc.col(hm, r, 'Sales Employee')),
      str(Calc.col(hm, r, 'Distribution Channel')),
      str(Calc.col(hm, r, 'Distribution Channel1')),
      str(Calc.col(hm, r, 'Material')),
      str(Calc.col(hm, r, 'Plant')),
      Calc.num(Calc.col(hm, r, 'Qty')),
      Calc.num(Calc.col(hm, r, 'Sales Value'))
    ]);
  }
  if (!records.length) {
    throw new UploadError(`No sales rows dated in ${scope.label} were found in this file.${rangeText(seenDates)}`);
  }
  return {
    dataset: 'sales',
    table: 'sales_rows',
    columns: colsFromRecords(
      [
        ['sales_org', 'text'], ['billing_date', 'date'], ['billing_document', 'text'], ['billing_type', 'text'],
        ['bill_to_party', 'text'], ['sales_employee', 'text'], ['distribution_channel', 'text'],
        ['distribution_channel1', 'text'], ['material', 'text'], ['plant', 'text'], ['qty', 'numeric'], ['sales_value', 'numeric']
      ],
      records
    ),
    rowCount: records.length,
    scope,
    ...preview(canonical[0], canonical.slice(1)),
    meta: { month: scope.month, period: scope.period, ignoredOutsideMonth: outside, skippedRowsWithoutValidDate: skipped }
  };
}

function parseTarget(wb: XLSX.WorkBook): ParsedUpload {
  const rows = firstSheetRows(wb);
  assertColumns('target', rows[0], 'Target');
  const hm = Calc.headerMap(rows[0]);
  const records: Array<Array<string | number | null>> = [];
  let rowNo = 0;
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || !r.length) continue;
    if (!str(Calc.col(hm, r, 'Main Channel')) && !str(Calc.col(hm, r, 'Sub Channel'))) continue;
    rowNo++;
    const main = str(Calc.col(hm, r, 'Main Channel')) || 'Unassigned';
    const sub = str(Calc.col(hm, r, 'Sub Channel')) || 'Unassigned';
    for (const month of Calc.MONTHS as string[]) {
      records.push([
        rowNo,
        str(Calc.col(hm, r, 'Sales Organization')),
        main,
        sub,
        str(Calc.col(hm, r, 'Responsible Person')),
        str(Calc.col(hm, r, 'Channel Code')),
        month,
        Calc.num(Calc.col(hm, r, month))
      ]);
    }
  }
  return {
    dataset: 'target',
    table: 'target_rows',
    columns: colsFromRecords(
      [['row_no', 'integer'], ['sales_org', 'text'], ['main_channel', 'text'], ['sub_channel', 'text'], ['responsible_person', 'text'], ['channel_code', 'text'], ['month', 'text'], ['amount', 'numeric']],
      records
    ),
    rowCount: rowNo,
    ...preview(rows[0], rows.slice(1)),
    meta: {}
  };
}

function parseExpenses(wb: XLSX.WorkBook, scope: MonthScope): ParsedUpload {
  const rows = firstSheetRows(wb);
  assertColumns('expenses', rows[0], 'Expenses Report');
  const hm = Calc.headerMap(rows[0]);
  const descCol: string | null = hm['g/l description'] !== undefined ? 'G/L Description' : hm['account description'] !== undefined ? 'Account Description' : null;
  const records: Array<Array<string | number | null>> = [];
  let outside = 0;
  let undated = 0;
  const seenDates: string[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || !r.length) continue;
    const companyCode = Calc.col(hm, r, 'Company Code');
    // SAP subtotal / footer rows carry a non-integer Company Code — never a transaction row.
    if (companyCode === undefined || !/^\d+$/.test(str(companyCode))) continue;
    const postingDate = isoDate(Calc.col(hm, r, 'Posting Date'));
    if (!postingDate) {
      undated++;
      continue;
    }
    seenDates.push(postingDate);
    if (postingDate < scope.from || postingDate >= scope.to) {
      outside++;
      continue;
    }
    records.push([
      str(companyCode),
      str(Calc.col(hm, r, 'G/L Account')),
      str(Calc.col(hm, r, 'Document Number')),
      str(Calc.col(hm, r, 'Document Type')),
      postingDate,
      Calc.normalizeCostCenter(Calc.col(hm, r, 'Cost Center')),
      Calc.num(Calc.col(hm, r, 'Amount in Local Currency')),
      descCol ? str(Calc.col(hm, r, descCol)) : ''
    ]);
  }
  if (!records.length) {
    throw new UploadError(`No expense rows posted in ${scope.label} were found in this file.${rangeText(seenDates)}`);
  }
  return {
    dataset: 'expenses',
    table: 'expense_rows',
    columns: colsFromRecords(
      [['company_code', 'text'], ['gl_account', 'text'], ['document_number', 'text'], ['document_type', 'text'], ['posting_date', 'date'], ['cost_center', 'text'], ['amount', 'numeric'], ['gl_description', 'text']],
      records
    ),
    rowCount: records.length,
    scope,
    ...preview(rows[0], rows.slice(1)),
    meta: { month: scope.month, period: scope.period, ignoredOutsideMonth: outside, skippedRowsWithoutValidDate: undated }
  };
}

function parseGl(wb: XLSX.WorkBook): ParsedUpload {
  const rows = firstSheetRows(wb);
  assertColumns('gl', rows[0], 'G/L Category Mapping');
  const hm = Calc.headerMap(rows[0]);
  const records: Array<Array<string | number | null>> = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || !r.length) continue;
    const code = str(Calc.col(hm, r, 'GL Code'));
    if (!code) continue;
    records.push([str(Calc.col(hm, r, 'GL Category')), code, str(Calc.col(hm, r, 'GL Name'))]);
  }
  return {
    dataset: 'gl',
    table: 'gl_mapping',
    columns: colsFromRecords([['gl_category', 'text'], ['gl_code', 'text'], ['gl_name', 'text']], records),
    rowCount: records.length,
    ...preview(rows[0], rows.slice(1)),
    meta: {}
  };
}

function parseMm60(wb: XLSX.WorkBook): ParsedUpload {
  const rows = firstSheetRows(wb);
  assertColumns('mm60', rows[0], 'MM60 Item Cost');
  const hm = Calc.headerMap(rows[0]);
  // Later rows win for the same Material+Plant, exactly like the original map build.
  const byKey = new Map<string, Array<string | number | null>>();
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || !r.length) continue;
    const material = str(Calc.col(hm, r, 'Material')).toUpperCase();
    const plant = str(Calc.col(hm, r, 'Plant')).toUpperCase();
    if (!material && !plant) continue;
    const materialType = str(Calc.col(hm, r, 'Material type') || Calc.col(hm, r, 'Material Type')).toUpperCase();
    byKey.set(`${material}|${plant}`, [material, plant, materialType, Calc.num(Calc.col(hm, r, 'Price'))]);
  }
  const records = Array.from(byKey.values());
  return {
    dataset: 'mm60',
    table: 'mm60_item_cost',
    columns: colsFromRecords([['material', 'text'], ['plant', 'text'], ['material_type', 'text'], ['price', 'numeric']], records),
    rowCount: records.length,
    ...preview(rows[0], rows.slice(1)),
    meta: {}
  };
}

function parseVk13(wb: XLSX.WorkBook): ParsedUpload {
  const rows: Row[] = Calc.normalizeVK13Rows(firstSheetRows(wb));
  assertColumns('vk13', rows[0], 'VK13 Pricing');
  const header: string[] = rows[0];
  const idx = (name: string) => header.indexOf(name);
  const materialIdx = idx('Material');
  const amountIdx = idx('Amount');
  const unitIdx = idx('Unit');
  let perIdx = idx('per');
  if (perIdx === -1) perIdx = unitIdx;
  const diIdx = header.findIndex((h) => str(h).toLowerCase() === 'di');
  const byKey = new Map<string, Array<string | number | null>>();
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const material = str(r[materialIdx]).toUpperCase();
    if (!material) continue;
    const di = diIdx !== -1 ? str(r[diIdx]) : '';
    byKey.set(`${material}|${di.toUpperCase()}`, [
      material,
      di,
      unitIdx !== -1 ? str(r[unitIdx]).toUpperCase() : '',
      Calc.num(r[amountIdx]),
      perIdx !== -1 ? str(r[perIdx]) : ''
    ]);
  }
  const records = Array.from(byKey.values());
  return {
    dataset: 'vk13',
    table: 'vk13_pricing',
    columns: colsFromRecords([['material', 'text'], ['distribution_channel', 'text'], ['currency', 'text'], ['amount', 'numeric'], ['per', 'text']], records),
    rowCount: records.length,
    ...preview(rows[0], rows.slice(1)),
    meta: {}
  };
}

function parseCostCenters(wb: XLSX.WorkBook): ParsedUpload {
  const required = (REQUIRED_COLUMNS.costCenters || []).map((c) => c.toLowerCase());
  let found: Row[] | null = null;
  for (const name of wb.SheetNames) {
    const rows = sheetToRows(wb.Sheets[name]);
    if (!rows.length) continue;
    const hdr = (rows[0] || []).map((h) => str(h).toLowerCase());
    if (required.every((c) => hdr.indexOf(c) !== -1)) {
      found = rows;
      break;
    }
  }
  if (!found) throw new UploadError('No worksheet containing the required Cost Center mapping columns was found.');
  const result = Calc.buildCostCenterMap(found);
  if (!result.uniqueCount) throw new UploadError('No valid cost centers were found in the uploaded workbook.');
  const records = Object.keys(result.rowsByCC).map((cc) => {
    const row = result.rowsByCC[cc];
    return [cc, row.name, row.description, row.allocationBase, row.allocatedChannel] as Array<string | number | null>;
  });
  return {
    dataset: 'costCenters',
    table: 'cost_centers',
    columns: colsFromRecords(
      [['cost_center', 'text'], ['name', 'text'], ['description', 'text'], ['allocation_base', 'text'], ['allocated_channel', 'text']],
      records
    ),
    rowCount: records.length,
    ...preview(found[0], found.slice(1)),
    meta: { uniqueCount: result.uniqueCount }
  };
}

function parseDebtor(wb: XLSX.WorkBook, scope: MonthScope): ParsedUpload {
  const rows = firstSheetRows(wb);
  assertColumns('debtor', rows[0], 'Debtor Summary Report');
  const hm = Calc.headerMap(rows[0]);
  const records: Array<Array<string | number | null>> = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || !r.length) continue;
    const channel = str(Calc.col(hm, r, 'Sales Channel'));
    const values = [
      Calc.num(Calc.col(hm, r, 'Total Amount')),
      Calc.num(Calc.col(hm, r, '0 - 30 Days')),
      Calc.num(Calc.col(hm, r, '30 - 60 Days')),
      Calc.num(Calc.col(hm, r, '60 - 75 Days')),
      Calc.num(Calc.col(hm, r, '75 - 90 Days')),
      Calc.num(Calc.col(hm, r, 'Over 90 Days'))
    ];
    if (!channel && values.every((v) => !v)) continue;
    records.push([str(Calc.col(hm, r, 'Main Channel')), channel, ...values, scope.period]);
  }
  return {
    dataset: 'debtor',
    table: 'debtor_rows',
    columns: colsFromRecords(
      [['main_channel', 'text'], ['sales_channel', 'text'], ['total_amount', 'numeric'], ['d0_30', 'numeric'], ['d30_60', 'numeric'], ['d60_75', 'numeric'], ['d75_90', 'numeric'], ['over_90', 'numeric'], ['period', 'text']],
      records
    ),
    rowCount: records.length,
    scope,
    ...preview(rows[0], rows.slice(1)),
    meta: { month: scope.month, period: scope.period }
  };
}

function parseInventory(wb: XLSX.WorkBook, scope: MonthScope): ParsedUpload {
  const rows = firstSheetRows(wb);
  const hm = Calc.headerMap(rows[0] || []);
  if (hm['channel'] === undefined && hm['sub channel'] === undefined && hm['channel code'] === undefined) {
    throw new UploadError("This file doesn't match the expected format for Inventory Report. Missing column(s): Channel, Channel Code, Over 90 Days Value.", ['Channel', 'Channel Code', 'Over 90 Days Value']);
  }
  const hasMonthCol = hm['month'] !== undefined;
  const records: Array<Array<string | number | null>> = [];
  let outside = 0;
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || !r.length) continue;
    const channel = str(Calc.col(hm, r, 'Channel') || Calc.col(hm, r, 'Sub Channel'));
    const code = str(Calc.col(hm, r, 'Channel Code'));
    if (!channel && !code) continue;
    // A file that carries its own Month column is filtered to the month selected for the upload.
    if (hasMonthCol) {
      const raw = Calc.col(hm, r, 'Month');
      const rowMonth = typeof raw === 'number' ? Calc.monthNameFromSerial(raw) || '' : str(raw);
      if (rowMonth.toLowerCase() !== scope.month.toLowerCase()) {
        outside++;
        continue;
      }
    }
    let over90 = Calc.num(Calc.col(hm, r, 'Over 90 Days Value'));
    if (!over90) over90 = Calc.num(Calc.col(hm, r, 'Total Over 90 Days Value'));
    records.push([scope.month, channel, code, over90, scope.period]);
  }
  if (!records.length) {
    throw new UploadError(`No inventory rows for ${scope.month} were found in this file.`);
  }
  return {
    dataset: 'inventory',
    table: 'inventory_rows',
    columns: colsFromRecords([['month', 'text'], ['channel', 'text'], ['channel_code', 'text'], ['over_90_value', 'numeric'], ['period', 'text']], records),
    rowCount: records.length,
    scope,
    ...preview(rows[0] || [], rows.slice(1)),
    meta: { month: scope.month, period: scope.period, hasMonthColumn: hasMonthCol, ignoredOtherMonths: outside }
  };
}

function parseDistExclusion(wb: XLSX.WorkBook): ParsedUpload {
  const rows = firstSheetRows(wb);
  const header = (rows[0] || []).map((h) => str(h).toLowerCase());
  let idx = header.findIndex((h) => h === 'bill to party' || h === 'bill-to party');
  const start = idx !== -1 ? 1 : 0;
  if (idx === -1) idx = 0;
  const codes = new Set<string>();
  for (let i = start; i < rows.length; i++) {
    const code = str(rows[i] && rows[i][idx]).toUpperCase();
    if (code) codes.add(code);
  }
  if (!codes.size) throw new UploadError('No Bill-to Party codes were found in this file.');
  const records = Array.from(codes).map((c) => [c] as Array<string | number | null>);
  return {
    dataset: 'distExclusion',
    table: 'distributor_exclusions',
    columns: colsFromRecords([['bill_to_party', 'text']], records),
    rowCount: records.length,
    ...preview(['Bill To Party'], records),
    meta: {}
  };
}

type Parser = (wb: XLSX.WorkBook, scope: MonthScope) => ParsedUpload;

const PARSERS: Record<DatasetKey, Parser> = {
  sales: parseSales,
  target: parseTarget,
  expenses: parseExpenses,
  gl: parseGl,
  mm60: parseMm60,
  vk13: parseVk13,
  costCenters: parseCostCenters,
  debtor: parseDebtor,
  inventory: parseInventory,
  distExclusion: parseDistExclusion
};

/** `scope` is required for month-based datasets (see importers/monthly.ts) and ignored for reference data. */
export function parseUpload(dataset: DatasetKey, buffer: Uint8Array, scope?: MonthScope): ParsedUpload {
  const parser = PARSERS[dataset];
  if (!parser) throw new UploadError(`Unknown dataset "${dataset}".`);
  if (isMonthly(dataset) && !scope) throw new UploadError('Select the month this file belongs to before uploading.');
  return parser(readWorkbook(buffer), scope as MonthScope);
}

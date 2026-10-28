import { pool } from '../db/pool';
import { DashboardCalc as Calc } from '../calc/calc';
import { periodToMonth } from '../fiscal';
import type { DatasetKey } from '../importers/parse';
import { getSettings, type AppSettings } from './settings';

type Rows = any[][];

/** The raw "file" arrays the calculation engine consumes (header row + data rows). */
export interface CalcFiles {
  salesRows: Rows;
  targetRows: Rows;
  expenseRows: Rows;
  glRows: Rows;
  mm60Rows: Rows;
  vk13Rows: Rows;
  costCenterRows: Rows;
  distributorExclusionRows: Rows | undefined;
  debtorRows: Rows;
  inventoryRows: Rows;
  mm60SurchargePct: number;
  vk13ExchangeRates: AppSettings['vk13ExchangeRates'];
}

export interface DataContext {
  dataset: any;
  files: CalcFiles;
  settings: AppSettings;
  /** Manually entered Electrician Point amount per month name (e.g. { June: 1000000 }). */
  electricianByMonth: Record<string, number>;
  lastUpdated: string | null;
}

async function queryRows(text: string): Promise<any[][]> {
  const res = await pool.query({ text, rowMode: 'array' });
  return res.rows;
}

const LOADERS: Record<DatasetKey, () => Promise<Rows | undefined>> = {
  async sales() {
    return [
      ['Billing Date', 'Distribution Channel', 'Distribution Channel1', 'Bill-to Party', 'Sales Employee', 'Material', 'Plant', 'Qty', 'Sales Value'],
      ...(await queryRows(
        `SELECT billing_date::text, distribution_channel, distribution_channel1, bill_to_party, sales_employee, material, plant, qty, sales_value
           FROM sales_rows ORDER BY id`
      ))
    ];
  },
  async target() {
    const rows = await queryRows('SELECT row_no, main_channel, sub_channel, month, amount FROM target_rows ORDER BY row_no, id');
    const wide = new Map<number, any>();
    for (const [rowNo, main, sub, month, amount] of rows) {
      if (!wide.has(rowNo)) wide.set(rowNo, { main, sub, months: {} as Record<string, number> });
      wide.get(rowNo).months[month] = amount;
    }
    const months: string[] = Calc.MONTHS;
    return [
      ['Main Channel', 'Sub Channel', ...months],
      ...Array.from(wide.values()).map((w) => [w.main, w.sub, ...months.map((m) => w.months[m] ?? 0)])
    ];
  },
  async expenses() {
    return [
      ['Company Code', 'G/L Account', 'Posting Date', 'Amount in Local Currency', 'Cost Center', 'G/L Description'],
      ...(await queryRows(
        `SELECT company_code, gl_account, COALESCE(posting_date::text, ''), amount, cost_center, COALESCE(gl_description, '')
           FROM expense_rows ORDER BY id`
      ))
    ];
  },
  async gl() {
    return [['GL Category', 'GL Code', 'GL Name'], ...(await queryRows('SELECT gl_category, gl_code, COALESCE(gl_name, \'\') FROM gl_mapping ORDER BY id'))];
  },
  async mm60() {
    return [['Material', 'Plant', 'Material Type', 'Price'], ...(await queryRows('SELECT material, plant, material_type, price FROM mm60_item_cost'))];
  },
  async vk13() {
    return [
      ['Material', 'Amount', 'Unit', 'per', 'DI'],
      ...(await queryRows('SELECT material, amount, COALESCE(currency, \'\'), COALESCE(per, \'\'), distribution_channel FROM vk13_pricing'))
    ];
  },
  async costCenters() {
    const rows = await queryRows(
      `SELECT cost_center, COALESCE(name, ''), COALESCE(description, ''), COALESCE(allocation_base, ''), COALESCE(allocated_channel, '')
         FROM cost_centers`
    );
    return rows.length ? [['Cost Center', 'Name', 'Description', 'Allocation Base', 'Allocated Channel'], ...rows] : [];
  },
  async debtor() {
    // Each row carries its month name in a trailing "Month" column (rows without a period are ignored).
    const rows = await queryRows(
      `SELECT COALESCE(main_channel, ''), sales_channel, total_amount, d0_30, d30_60, d60_75, d75_90, over_90, period
         FROM debtor_rows WHERE period IS NOT NULL ORDER BY id`
    );
    return [
      ['Main Channel', 'Sales Channel', 'Total Amount', '0 - 30 Days', '30 - 60 Days', '60 - 75 Days', '75 - 90 Days', 'Over 90 Days', 'Month'],
      ...rows.map((r) => [...r.slice(0, 8), periodToMonth(r[8]) ?? '']).filter((r) => r[8])
    ];
  },
  async inventory() {
    // Always include the Month column: the engine then scopes inventory interest to the selected month.
    const rows = await queryRows(
      `SELECT period, COALESCE(channel, ''), COALESCE(channel_code, ''), over_90_value
         FROM inventory_rows WHERE period IS NOT NULL ORDER BY id`
    );
    return [
      ['Month', 'Channel', 'Channel Code', 'Over 90 Days Value'],
      ...rows.map((r) => [periodToMonth(r[0]) ?? '', r[1], r[2], r[3]]).filter((r) => r[0])
    ];
  },
  async distExclusion() {
    const rows = await queryRows('SELECT bill_to_party FROM distributor_exclusions ORDER BY bill_to_party');
    // No uploaded list -> undefined, so the engine falls back to its built-in default list.
    return rows.length ? [['Bill To Party'], ...rows] : undefined;
  }
};

/**
 * Caches the raw calculation inputs per dataset and the built dataset itself.
 * Uploads invalidate one dataset; settings changes only rebuild the dataset.
 */
class DataStore {
  private raw = new Map<DatasetKey, Rows | undefined>();
  private context: Promise<DataContext> | null = null;

  invalidate(dataset?: DatasetKey): void {
    if (dataset) this.raw.delete(dataset);
    else this.raw.clear();
    this.context = null;
  }

  private async load(dataset: DatasetKey): Promise<Rows | undefined> {
    if (!this.raw.has(dataset)) this.raw.set(dataset, await LOADERS[dataset]());
    return this.raw.get(dataset);
  }

  get(): Promise<DataContext> {
    if (!this.context) {
      this.context = this.build().catch((err) => {
        this.context = null;
        throw err;
      });
    }
    return this.context;
  }

  private async build(): Promise<DataContext> {
    const [settings, sales, target, expenses, gl, mm60, vk13, costCenters, debtor, inventory, distExclusion] = await Promise.all([
      getSettings(),
      this.load('sales'),
      this.load('target'),
      this.load('expenses'),
      this.load('gl'),
      this.load('mm60'),
      this.load('vk13'),
      this.load('costCenters'),
      this.load('debtor'),
      this.load('inventory'),
      this.load('distExclusion')
    ]);
    const files: CalcFiles = {
      salesRows: sales!,
      targetRows: target!,
      expenseRows: expenses!,
      glRows: gl!,
      mm60Rows: mm60!,
      vk13Rows: vk13!,
      costCenterRows: costCenters!,
      debtorRows: debtor!,
      inventoryRows: inventory!,
      distributorExclusionRows: distExclusion,
      mm60SurchargePct: settings.mm60SurchargePct,
      vk13ExchangeRates: settings.vk13ExchangeRates
    };
    const dataset = Calc.buildDataset(files);
    const electricianByMonth: Record<string, number> = {};
    const { rows: periodRows } = await pool.query('SELECT period, electrician_point FROM periods WHERE electrician_point <> 0');
    for (const r of periodRows) {
      const month = periodToMonth(r.period);
      if (month) electricianByMonth[month] = Number(r.electrician_point);
    }
    const { rows } = await pool.query(
      `SELECT GREATEST((SELECT max(uploaded_at) FROM upload_batches), (SELECT max(updated_at) FROM settings)) AS last_updated`
    );
    const lastUpdated: Date | null = rows[0].last_updated;
    return { dataset, files, settings, electricianByMonth, lastUpdated: lastUpdated ? lastUpdated.toISOString() : null };
  }
}

export const dataStore = new DataStore();

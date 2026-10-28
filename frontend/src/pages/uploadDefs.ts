export interface UploadDef {
  key: string;
  label: string;
  cadence: string;
  accept: string;
  columns: string[];
  sample: string[][];
  note?: string;
  removable?: boolean;
  /** Uploaded for one chosen month (and lockable); otherwise reference data. */
  monthly?: boolean;
  showSurchargeInput?: boolean;
  showExchangeRateInput?: boolean;
}

const XLSX = '.xlsx,.xls';
const XLSX_CSV = '.xlsx,.xls,.csv';

export const UPLOAD_DEFS: UploadDef[] = [
  {
    key: 'sales', monthly: true, label: 'Sales Report', cadence: 'Monthly upload', accept: XLSX,
    columns: ['Plant', 'Billing Date', 'Bill-to Party', 'Distribution Channel', 'Distribution Channel1', 'Sales Employee', 'Material', 'Qty', 'Sales Value', '...'],
    sample: [['B100', '46215', '26AJ01', '14', 'Wireman, Ruhunu & PV', '15547', '108-1163', '500', '113342.50'], ['B100', '46215', '25HG02', '14', 'Wireman, Ruhunu & PV', '10315', '108-1001', '300', '58596.95']],
    note: 'Also accepts a raw BW/BI export (metadata rows + duplicate Distribution Channel / Bill-to Party / Sales Employee / Plant / Material columns, "Sales Volume Qty", "Net Sales Volume") — it is auto-detected and normalized. Only rows dated in the selected month are imported; rows from other months are ignored.'
  },
  {
    key: 'target', label: 'Target 26/27', cadence: 'Yearly upload', accept: XLSX,
    columns: ['Sales Organization', 'Main Channel', 'Sub Channel', 'Responsible Person', 'April', 'May', '...', 'March'],
    sample: [['Modern Trade', 'Supermarket', 'J. Perera', '1,50,000', '1,60,000', '…'], ['General Trade', 'Wholesale', 'K. Silva', '48,000', '50,500', '…']]
  },
  {
    key: 'expenses', monthly: true, label: 'Expenses Report', cadence: 'Monthly upload', accept: XLSX,
    columns: ['Company Code', 'G/L Account', 'Document Number', 'Document Type', 'Posting Date', 'Posting Period', 'Amount in Local Currency', '...'],
    sample: [['1100', '630011', '25-Apr-26', '2', '12,400'], ['1600', '600019', '03-May-26', '2', '8,750']],
    note: 'Only rows posted in the selected month are imported; rows from other months are ignored.'
  },
  {
    key: 'gl', label: 'G/L Category Mapping', cadence: 'Yearly upload', accept: XLSX,
    columns: ['GL Category', 'GL Code', 'GL Name', 'REMARKS'],
    sample: [['Administration Expenses', '630011', 'Exgratia Payment', ''], ['Cost Of Sales', '600019', 'Royalty Expenses', '']]
  },
  {
    key: 'mm60', label: 'MM60 Item Cost', cadence: 'Yearly upload', accept: XLSX, showSurchargeInput: true,
    columns: ['Material', 'Plant', 'Material type', 'Material Description', 'Price', '...'],
    sample: [['100-0110', 'B142', 'ROH', '...', '245.00'], ['100-0230', 'H105', 'FERT', '...', '1,120.00']]
  },
  {
    key: 'vk13', label: 'VK13 Pricing', cadence: 'Yearly upload', accept: XLSX, showExchangeRateInput: true,
    columns: ['Material', 'Amount', 'Unit', 'UoM'],
    sample: [['100-0110', '168.92', '1', 'PC'], ['100-0230', '640.60', '1', 'PC']],
    note: 'Used only for materials whose MM60 Material Type is FERT or HALB. Also accepts a raw VK13 SAP export (title/blank rows, padded header) — it is auto-detected and normalized. LKR rows: Local Currency Price = Amount ÷ per. Non-LKR rows: converted first using the VK13 Exchange Rate below.'
  },
  {
    key: 'distExclusion', label: 'Distributor Delivery Cost Exclusion List', cadence: 'Update anytime', accept: XLSX_CSV,
    columns: ['Bill To Party'],
    sample: [['02IU01'], ['07DA01'], ['08PE02']],
    note: 'Distributor (Sub Channel) Bill-to Party codes to exclude from the 0.85% Distribution Cost calculation. Their Primary Sales, Warehouse Cost, and all other KPIs remain unaffected — only Distribution Cost is excluded for these codes. Replaces the built-in default list when uploaded.'
  },
  {
    key: 'costCenters', label: 'Cost Centers', cadence: 'Update anytime', accept: XLSX, removable: true,
    columns: ['Cost Center', 'Name', 'Description', 'Allocation Base', 'Allocated Channel'],
    sample: [['1100700201', 'Direct Dealer', 'Direct Dealer branch', 'Direct', 'Direct Dealer'], ['1100700300', 'Projects', 'Projects parent', 'Allocate based on the target %', '1100700300 Range']],
    note: 'Upload the Product Company cost-center mapping used to filter and allocate expenses. Any worksheet containing these columns is auto-detected — worksheet name and filename do not matter.'
  },
  {
    key: 'debtor', monthly: true, label: 'Debtor Summary Report', cadence: 'Monthly upload', accept: XLSX_CSV,
    columns: ['Main Channel', 'Sales Channel', 'Total Amount', '0 - 30 Days', '30 - 60 Days', '60 - 75 Days', '75 - 90 Days', 'Over 90 Days'],
    sample: [['Distribution', 'Direct Dealer', '10,000,000', '5,000,000', '2,000,000', '1,000,000', '1,000,000', '1,000,000'], ['Distribution', 'Distributor', '25,000,000', '10,000,000', '5,000,000', '3,000,000', '3,000,000', '4,000,000']],
    note: 'Feeds the Debtor Interest column in Warehouse & Distribution Cost Allocation. Per Sales Channel row: Over 60 Debtor Value = 60-75 Days + 75-90 Days + Over 90 Days, then Debtor Interest = Over 60 Debtor Value × 1%.'
  },
  {
    key: 'inventory', monthly: true, label: 'Inventory Report', cadence: 'Monthly upload', accept: XLSX_CSV,
    columns: ['Channel', 'Channel Code', 'Over 90 Days Value'],
    sample: [['Direct Dealer', '11', '100,000,000'], ['Distributor', '12', '50,000,000']],
    note: 'Feeds the Inventory Interest column in Warehouse & Distribution Cost Allocation. Per channel: Inventory Interest = Over 90 Days Value × 1%. If the file has a Month column, only rows for the selected month are imported.'
  }
];

export const MONTHLY_DEFS = UPLOAD_DEFS.filter((d) => d.monthly);
export const REFERENCE_DEFS = UPLOAD_DEFS.filter((d) => !d.monthly);

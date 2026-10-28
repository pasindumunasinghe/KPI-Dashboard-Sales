import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { findMonth, fiscalMonths, periodToMonth } from '../fiscal';
import { parseUpload, UploadError, type MonthScope } from './parse';

const scopeOf = (month: string) => findMonth(month) as MonthScope;

function workbook(rows: unknown[][], sheet = 'Sheet1'): Uint8Array {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), sheet);
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Uint8Array;
}

const col = (parsed: ReturnType<typeof parseUpload>, name: string) => parsed.columns.find((c) => c.name === name)!.values;

describe('sales import', () => {
  const header = ['Sales Organization', 'Billing Date', 'Bill-to Party', 'Bill-to Party', 'Sales Employee', 'Sales Employee', 'Distribution Channel', 'Distribution Channel', 'Material', 'Material', 'Plant', 'Plant', 'Sales Volume Qty', 'Net Sales Volume'];

  it('normalises a raw BW export: keeps allowed orgs, converts serial dates and numbers', () => {
    const parsed = parseUpload(
      'sales',
      workbook([
        ['Query Name', 'x'],
        header,
        ['Orel Corporation', 46163, '25OC02', 'Name', '10265', 'Emp', '14', 'Wireman, Ruhunu & PV', '108-1', 'desc', 'B100', 'desc', 120, 35636.4],
        ['Some Other Org', 46163, '25OC02', 'Name', '1', 'Emp', '14', 'Local', '108-2', 'desc', 'B100', 'desc', 1, 1],
        ['Orel Corporation', 46203, '25OC02', 'Name', '10265', 'Emp', '14', 'Local', '108-3', 'desc', 'B100', 'desc', 5, 5]
      ]),
      scopeOf('May')
    );
    // The June-dated row is not part of the May upload and is reported as ignored.
    expect(parsed.rowCount).toBe(1);
    expect(parsed.meta.ignoredOutsideMonth).toBe(1);
    expect(col(parsed, 'billing_date')).toEqual(['2026-05-21']);
    expect(col(parsed, 'distribution_channel')).toEqual(['14']);
    expect(col(parsed, 'distribution_channel1')).toEqual(['Wireman, Ruhunu & PV']);
    expect(col(parsed, 'qty')).toEqual([120]);
    expect(col(parsed, 'sales_value')).toEqual([35636.4]);
  });

  it('rejects a file with missing columns and names them', () => {
    expect.assertions(2);
    try {
      parseUpload('sales', workbook([['Billing Date', 'Material'], [46163, 'x']]), scopeOf('May'));
    } catch (e) {
      expect(e).toBeInstanceOf(UploadError);
      expect((e as UploadError).missing).toContain('Distribution Channel');
    }
  });
});

describe('month selection', () => {
  const sales = workbook([
    ['Billing Date', 'Distribution Channel', 'Distribution Channel1', 'Bill-to Party', 'Sales Employee', 'Material', 'Plant', 'Qty', 'Sales Value'],
    [46163, '14', 'Local', 'X', '1', 'M', 'B100', 1, 10]
  ]);

  it('requires a month for month-based datasets', () => {
    expect(() => parseUpload('sales', sales)).toThrow(/Select the month/);
  });

  it('explains when the file has nothing for the chosen month', () => {
    expect(() => parseUpload('sales', sales, scopeOf('July'))).toThrow(/No sales rows dated in July 2026.*2026-05-21/);
  });

  it('does not need a month for reference data', () => {
    const gl = workbook([['GL Category', 'GL Code'], ['Administration Expenses', 630011]]);
    expect(parseUpload('gl', gl).rowCount).toBe(1);
  });

  it('tags debtor rows with the selected period', () => {
    const debtor = workbook([['Sales Channel', 'Over 90 Days'], ['Distributor', 100]]);
    const parsed = parseUpload('debtor', debtor, scopeOf('June'));
    expect(col(parsed, 'period')).toEqual(['2026-06']);
  });

  it('keeps only the selected month from an inventory file that has a Month column', () => {
    const inv = workbook([['Month', 'Channel', 'Channel Code', 'Over 90 Days Value'], ['May', 'Direct Dealer', '11', 1], ['June', 'Direct Dealer', '11', 2]]);
    const parsed = parseUpload('inventory', inv, scopeOf('June'));
    expect(col(parsed, 'over_90_value')).toEqual([2]);
    expect(col(parsed, 'period')).toEqual(['2026-06']);
  });
});

describe('financial-year calendar', () => {
  it('maps April..March to the right calendar months', () => {
    const m = fiscalMonths();
    expect(m).toHaveLength(12);
    expect(m[0]).toMatchObject({ month: 'April', period: '2026-04', from: '2026-04-01', to: '2026-05-01' });
    expect(m[8]).toMatchObject({ month: 'December', period: '2026-12', to: '2027-01-01' });
    expect(m[9]).toMatchObject({ month: 'January', period: '2027-01', from: '2027-01-01' });
    expect(m[11]).toMatchObject({ month: 'March', period: '2027-03', to: '2027-04-01' });
  });
  it('converts periods back to month names', () => {
    expect(periodToMonth('2026-06')).toBe('June');
    expect(periodToMonth('2025-06')).toBeNull();
  });
});

describe('expenses import', () => {
  it('skips SAP footer rows with a non-integer company code', () => {
    const parsed = parseUpload(
      'expenses',
      workbook([
        ['Company Code', 'G/L Account', 'Posting Date', 'Amount in Local Currency', 'Cost Center'],
        ['1100', '630011', 46203, 1250.5, '1100700201'],
        ['Result', '', '', 999, ''],
        ['1100', '630011', 46100, 50, '1100700201']
      ]),
      scopeOf('June')
    );
    expect(parsed.rowCount).toBe(1);
    expect(col(parsed, 'cost_center')).toEqual(['1100700201']);
    expect(col(parsed, 'amount')).toEqual([1250.5]);
  });
});

describe('vk13 import', () => {
  it('finds the padded header in a raw SAP dump and keeps the last price per material + channel', () => {
    const parsed = parseUpload(
      'vk13',
      workbook([
        ['Table', '304'],
        ['', ' Sale', '      Di', '         Material', '                Amount', '      Unit', '   per'],
        ['', '1100', '10', '100-0110', '168.92', 'LKR', '1'],
        ['', '1100', '10', '100-0110', '170.00', 'LKR', '1'],
        ['', '1100', '12', '100-0110', '5', 'USD', '1']
      ])
    );
    expect(parsed.rowCount).toBe(2);
    expect(col(parsed, 'amount')).toEqual([170, 5]);
    expect(col(parsed, 'currency')).toEqual(['LKR', 'USD']);
  });
});

describe('target import', () => {
  it('stores one row per month for each target line', () => {
    const months = ['April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December', 'January', 'February', 'March'];
    const parsed = parseUpload(
      'target',
      workbook([
        ['Main Channel', 'Sub Channel', ...months],
        ['Distribution', 'Distributor', 100, 200, ...Array(10).fill('')]
      ])
    );
    expect(parsed.rowCount).toBe(1);
    expect(col(parsed, 'month')).toEqual(months);
    expect(col(parsed, 'amount').slice(0, 3)).toEqual([100, 200, 0]);
  });
});

describe('cost centers import', () => {
  it('finds the mapping on any worksheet', () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['notes']]), 'Notes');
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ['Cost Center', 'Name', 'Description', 'Allocation Base', 'Allocated Channel'],
        ['1100700201', 'Direct Dealer', 'dd', 'Direct', 'Direct Dealer']
      ]),
      'Mapping'
    );
    const parsed = parseUpload('costCenters', XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Uint8Array);
    expect(parsed.rowCount).toBe(1);
    expect(parsed.meta.uniqueCount).toBe(1);
  });
});

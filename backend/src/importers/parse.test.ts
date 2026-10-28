import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { parseUpload, UploadError } from './parse';

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
        ['Some Other Org', 46163, '25OC02', 'Name', '1', 'Emp', '14', 'Local', '108-2', 'desc', 'B100', 'desc', 1, 1]
      ])
    );
    expect(parsed.rowCount).toBe(1);
    expect(col(parsed, 'billing_date')).toEqual(['2026-05-21']);
    expect(col(parsed, 'distribution_channel')).toEqual(['14']);
    expect(col(parsed, 'distribution_channel1')).toEqual(['Wireman, Ruhunu & PV']);
    expect(col(parsed, 'qty')).toEqual([120]);
    expect(col(parsed, 'sales_value')).toEqual([35636.4]);
  });

  it('rejects a file with missing columns and names them', () => {
    expect.assertions(2);
    try {
      parseUpload('sales', workbook([['Billing Date', 'Material'], [46163, 'x']]));
    } catch (e) {
      expect(e).toBeInstanceOf(UploadError);
      expect((e as UploadError).missing).toContain('Distribution Channel');
    }
  });
});

describe('expenses import', () => {
  it('skips SAP footer rows with a non-integer company code', () => {
    const parsed = parseUpload(
      'expenses',
      workbook([
        ['Company Code', 'G/L Account', 'Posting Date', 'Amount in Local Currency', 'Cost Center'],
        ['1100', '630011', 46203, 1250.5, '1100700201'],
        ['Result', '', '', 999, '']
      ])
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

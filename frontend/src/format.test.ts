import { describe, expect, it } from 'vitest';
import { fmtCurrency, fmtPct, fmtSignedAmount, fmtSignedPct, glLabel } from './format';

describe('fmtCurrency', () => {
  it('abbreviates millions and thousands', () => {
    expect(fmtCurrency(1946906430.4)).toBe('1,946.91 M');
    expect(fmtCurrency(12400)).toBe('12.40 K');
    expect(fmtCurrency(950)).toBe('950');
  });
  it('wraps negatives in brackets and handles missing values', () => {
    expect(fmtCurrency(-2500000)).toBe('(2.50 M)');
    expect(fmtCurrency(null)).toBe('—');
    expect(fmtCurrency(NaN)).toBe('—');
  });
});

describe('percent helpers', () => {
  it('formats percentages', () => {
    expect(fmtPct(21.26)).toBe('21.3%');
    expect(fmtPct(-4)).toBe('(4.0%)');
  });
  it('formats signed variance', () => {
    expect(fmtSignedPct(12.34)).toBe('+12.3%');
    expect(fmtSignedPct(-5)).toBe('-5.0%');
    expect(fmtSignedPct(null)).toBe('N/A');
    expect(fmtSignedAmount(1500, 'currency')).toBe('+1.50 K');
    expect(fmtSignedAmount(null, 'pct')).toBe('—');
  });
});

describe('glLabel', () => {
  it('falls back when no description exists', () => {
    expect(glLabel({ glAccount: '630011', description: 'Exgratia Payment' })).toBe('630011 — Exgratia Payment');
    expect(glLabel({ glAccount: '630011', description: '' })).toBe('630011 — (no description found)');
  });
});

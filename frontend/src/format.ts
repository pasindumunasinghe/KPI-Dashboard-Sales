/** Compact currency used across the dashboard: 1.23 M / 4.56 K / 789, negatives in brackets. */
export function fmtCurrency(n: number | null | undefined): string {
  if (n === undefined || n === null || isNaN(n)) return '—';
  const neg = n < 0;
  const v = Math.abs(n);
  const s =
    v >= 1000000
      ? Number((v / 1000000).toFixed(2)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' M'
      : v >= 1000
        ? Number((v / 1000).toFixed(2)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' K'
        : v.toLocaleString('en-IN', { maximumFractionDigits: 0 });
  return neg ? '(' + s + ')' : s;
}

export function fmtPct(n: number | null | undefined): string {
  if (n === undefined || n === null || isNaN(n)) return '—';
  const s = Math.abs(n).toFixed(1) + '%';
  return n < 0 ? '(' + s + ')' : s;
}

export function fmtSignedPct(pct: number | null): string {
  return pct === null ? 'N/A' : (pct >= 0 ? '+' : '') + pct.toFixed(1) + '%';
}

export function fmtSignedAmount(variance: number | null, fmt: 'currency' | 'pct'): string {
  if (variance === null) return '—';
  const f = fmt === 'pct' ? fmtPct : fmtCurrency;
  return (variance >= 0 ? '+' : '') + f(Math.abs(variance));
}

export function formatRelativeTime(iso: string | null): string {
  if (!iso) return '—';
  const date = new Date(iso);
  const mins = Math.floor((Date.now() - date.getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return mins + ' min ago';
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + ' hr ago';
  return date.toLocaleString();
}

export function glLabel(r: { glAccount: string; description: string }): string {
  return r.description ? `${r.glAccount} — ${r.description}` : `${r.glAccount} — (no description found)`;
}

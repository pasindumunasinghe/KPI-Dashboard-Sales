import type { CompareRow } from '../api/types';
import { fmtCurrency, fmtPct, fmtSignedAmount, fmtSignedPct } from '../format';

export function varianceClass(pct: number | null): string {
  if (pct === null) return 'muted';
  return pct >= 0 ? 'pos-good' : 'pos-bad';
}

export function CompareTable({ rows, prevLabel, currentLabel }: { rows: CompareRow[]; prevLabel: string; currentLabel: string }) {
  return (
    <table className="kpi">
      <thead>
        <tr>
          <th>KPI</th>
          <th className="val">{prevLabel}</th>
          <th className="val">{currentLabel}</th>
          <th className="val">Variance</th>
          <th className="val">Variance %</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const f = r.fmt === 'pct' ? fmtPct : fmtCurrency;
          return (
            <tr className="row" key={r.key}>
              <td>{r.label}</td>
              <td className="val">{r.prev === null ? '—' : f(r.prev)}</td>
              <td className="val">{f(r.current)}</td>
              <td className="val">{fmtSignedAmount(r.variance, r.fmt)}</td>
              <td className={'val ' + varianceClass(r.pct)}>{fmtSignedPct(r.pct)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

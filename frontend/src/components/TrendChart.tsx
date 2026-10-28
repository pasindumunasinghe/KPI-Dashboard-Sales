import { fmtCurrency } from '../format';

interface Point {
  month: string;
  value: number;
}

/** Simple line chart (primary sales per saved month) — same geometry as the original SVG. */
export function TrendChart({ points, labelSuffix = '' }: { points: Point[]; labelSuffix?: string }) {
  const max = Math.max(...points.map((p) => p.value), 1);
  const coords = points.map((p, i) => ({
    x: points.length > 1 ? (i / (points.length - 1)) * 600 + 20 : 320,
    y: 180 - (p.value / max) * 160,
    ...p
  }));
  return (
    <div className="chart-wrap">
      <svg viewBox="0 0 640 200" role="img" aria-label="Primary sales trend">
        <polyline points={coords.map((c) => `${c.x},${c.y}`).join(' ')} fill="none" stroke="var(--accent)" strokeWidth="2.5" />
        {coords.map((c) => (
          <circle key={c.month} cx={c.x} cy={c.y} r="4" fill="var(--accent)">
            <title>{`${c.month}: ${fmtCurrency(c.value)}`}</title>
          </circle>
        ))}
      </svg>
      <div className="chart-labels">
        {coords.map((c) => (
          <span key={c.month}>
            {c.month}
            {labelSuffix}
          </span>
        ))}
      </div>
    </div>
  );
}

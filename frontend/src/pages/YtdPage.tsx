import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { CompareTable } from '../components/CompareTable';
import { QueryState } from '../components/QueryState';
import { TrendChart } from '../components/TrendChart';

export function YtdPage() {
  const [current, setCurrent] = useState<string | undefined>();
  const [comparison, setComparison] = useState<string | undefined>();
  const q = useQuery({ queryKey: ['ytd', current, comparison], queryFn: () => api.ytd(current, comparison), placeholderData: (p) => p });
  const d = q.data;

  return (
    <div className="body">
      <div className="filter-bar">
        <div className="filter-group">
          <label className="filter-label">Financial Year</label>
          <select className="select" disabled value="FY26/27"><option value="FY26/27">FY26/27</option></select>
        </div>
        <div className="filter-group">
          <label className="filter-label" htmlFor="y-current">Current Month</label>
          <select id="y-current" className="select" value={d?.currentMonth || ''} onChange={(e) => setCurrent(e.target.value)}>
            {(d?.monthOptions || []).map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <div className="filter-group">
          <label className="filter-label" htmlFor="y-comparison">Comparison Month</label>
          <select id="y-comparison" className="select" value={d?.comparisonMonth || ''} onChange={(e) => setComparison(e.target.value)}>
            <option value="">— None —</option>
            {(d?.monthOptions || []).map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <div className="spacer" />
      </div>

      <QueryState isLoading={q.isLoading} error={q.error}>
        {d && !d.hasAnySnapshots && (
          <div className="card">
            <div className="empty-note">No monthly snapshots saved yet. Save snapshots from the Monthly Comparison tab first — YTD sums April through the selected month using only saved snapshots.</div>
          </div>
        )}
        {d && d.hasAnySnapshots && (
          <>
            {d.missingMonths.length > 0 && (
              <div className="banner">Missing snapshot(s) for: {d.missingMonths.join(', ')} — YTD totals only include saved months.</div>
            )}
            {!d.hasComparison && <div className="banner">No Comparison Month selected — showing Current Month YTD only.</div>}
            <div className="card">
              <div className="card-title">YTD KPI Comparison (April → selected month)</div>
              <CompareTable rows={d.table} prevLabel={`${d.comparisonMonth} YTD`} currentLabel={`${d.currentMonth} YTD`} />
            </div>
            <div className="card">
              <div className="card-title">Cumulative YTD Primary Sales Trend</div>
              <TrendChart points={d.trend.map((t) => ({ month: t.month, value: t.primarySales }))} labelSuffix=" YTD" />
            </div>
          </>
        )}
      </QueryState>
    </div>
  );
}

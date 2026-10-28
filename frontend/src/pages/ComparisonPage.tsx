import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { CompareTable, varianceClass } from '../components/CompareTable';
import { QueryState } from '../components/QueryState';
import { TrendChart } from '../components/TrendChart';
import { useFilters } from '../FiltersContext';
import { fmtCurrency, fmtPct, fmtSignedPct } from '../format';

export function ComparisonPage() {
  const { canManageData } = useAuth();
  const filters = useFilters();
  const queryClient = useQueryClient();
  const [current, setCurrent] = useState<string | undefined>();
  const [prev, setPrev] = useState<string | undefined>();
  const [message, setMessage] = useState('');

  const q = useQuery({ queryKey: ['comparison', current, prev], queryFn: () => api.comparison(current, prev), placeholderData: (p) => p });
  const snapshots = useQuery({ queryKey: ['snapshots'], queryFn: api.snapshots, enabled: canManageData });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['comparison'] });
    void queryClient.invalidateQueries({ queryKey: ['ytd'] });
    void queryClient.invalidateQueries({ queryKey: ['snapshots'] });
  };

  const save = useMutation({
    mutationFn: (mode: 'replace' | 'new_version') => api.saveSnapshot(filters.month, mode, parseFloat(filters.gp) || 0, parseFloat(filters.npat) || 0),
    onSuccess: () => {
      setCurrent(filters.month);
      setPrev(undefined);
      setMessage('');
      refresh();
    },
    onError: (e) => setMessage(e instanceof Error ? e.message : 'Could not save snapshot.')
  });
  const remove = useMutation({ mutationFn: (id: number) => api.deleteSnapshot(id), onSuccess: refresh });

  function onSave() {
    if (filters.month === 'ALL') {
      window.alert('Select a specific Month (not "All Months") on the Dashboard tab before saving a snapshot.');
      return;
    }
    const exists = q.data?.monthOptions.includes(filters.month);
    const replace = exists ? window.confirm(`A snapshot for ${filters.month} already exists. Click OK to replace it, or Cancel to save as a new version.`) : true;
    save.mutate(replace ? 'replace' : 'new_version');
  }

  const d = q.data;
  return (
    <div className="body">
      <div className="filter-bar">
        <div className="filter-group">
          <label className="filter-label">Financial Year</label>
          <select className="select" disabled value="FY26/27"><option value="FY26/27">FY26/27</option></select>
        </div>
        <div className="filter-group">
          <label className="filter-label" htmlFor="c-current">Current Month</label>
          <select id="c-current" className="select" value={d?.currentMonth || ''} onChange={(e) => { setCurrent(e.target.value); setPrev(undefined); }}>
            {(d?.monthOptions || []).map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <div className="filter-group">
          <label className="filter-label" htmlFor="c-prev">Compare Month</label>
          <select id="c-prev" className="select" value={d?.prevMonth || ''} onChange={(e) => setPrev(e.target.value)}>
            <option value="">— None —</option>
            {(d?.monthOptions || []).map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <div className="spacer" />
        {canManageData && (
          <button className="btn" onClick={onSave} disabled={save.isPending}>
            {save.isPending ? 'Saving…' : 'Save Snapshot for Selected Dashboard Month'}
          </button>
        )}
      </div>
      {message && <div className="msg error" role="alert">{message}</div>}

      <QueryState isLoading={q.isLoading} error={q.error}>
        {d && !d.hasAnySnapshots && (
          <div className="card">
            <div className="empty-note">
              No monthly snapshots saved yet.{' '}
              {canManageData
                ? 'Select a specific Month on the Dashboard tab (not "All Months"), then click "Save Snapshot for Selected Dashboard Month" above to create the first snapshot.'
                : 'Ask a finance user or administrator to save the first snapshot.'}
            </div>
          </div>
        )}
        {d && d.hasAnySnapshots && (
          <>
            {!d.hasPrev && <div className="banner">No previous month snapshot available for comparison — showing current month values only.</div>}

            <div className="hero-grid">
              {d.cards.map((c) => {
                const f = c.fmt === 'pct' ? fmtPct : fmtCurrency;
                return (
                  <div className="hero-card" key={c.key}>
                    <div className="hero-label">{c.label}</div>
                    <div className="hero-value">{f(c.current)}</div>
                    <div className="hero-foot">
                      <span className="hero-foot-muted">Prev {c.prev === null ? '—' : f(c.prev)}</span>
                      <span className={'badge ' + (c.pct === null ? 'none' : c.pct >= 0 ? 'good' : 'bad')}>{fmtSignedPct(c.pct)}</span>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="card">
              <div className="card-title">KPI Comparison</div>
              <CompareTable rows={d.table} prevLabel="Previous Month" currentLabel="Current Month" />
            </div>

            <div className="card">
              <div className="card-title">Sales Movement by Main Channel</div>
              <table className="kpi">
                <thead><tr><th>Channel</th><th className="val">Previous Sales</th><th className="val">Current Sales</th><th className="val">Change</th></tr></thead>
                <tbody>
                  {d.channels.map((c) => (
                    <tr className="row" key={c.channel}>
                      <td>{c.channel}</td>
                      <td className="val">{c.prev === null ? '—' : fmtCurrency(c.prev)}</td>
                      <td className="val">{fmtCurrency(c.current)}</td>
                      <td className={'val ' + varianceClass(c.pct)}>
                        {c.variance === null || c.pct === null ? '—' : `${c.variance >= 0 ? '+' : ''}${fmtCurrency(Math.abs(c.variance))} (${fmtSignedPct(c.pct)})`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="card">
              <div className="card-title">Sales Trend (all saved snapshots)</div>
              <TrendChart points={d.trend.map((t) => ({ month: t.month, value: t.primarySales }))} />
            </div>
          </>
        )}
      </QueryState>

      {canManageData && snapshots.data && snapshots.data.snapshots.length > 0 && (
        <div className="card">
          <div className="card-title">Saved snapshots</div>
          <table className="users">
            <thead><tr><th>Month</th><th>Version</th><th>Saved</th><th>By</th><th /></tr></thead>
            <tbody>
              {snapshots.data.snapshots.map((s) => (
                <tr key={s.id}>
                  <td>{s.month}</td>
                  <td>v{s.version}</td>
                  <td>{new Date(s.createdAt).toLocaleString()}</td>
                  <td>{s.createdBy || '—'}</td>
                  <td>
                    <button
                      className="btn small danger"
                      disabled={remove.isPending}
                      onClick={() => window.confirm(`Delete the ${s.month} v${s.version} snapshot?`) && remove.mutate(s.id)}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

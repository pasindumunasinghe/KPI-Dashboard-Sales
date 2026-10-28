import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { api } from '../api/client';
import type { Achievement, BreakdownRow, DashboardData } from '../api/types';
import { QueryState } from '../components/QueryState';
import { useFilters } from '../FiltersContext';
import { fmtCurrency, fmtPct, glLabel } from '../format';
import { UPLOAD_DEFS } from './uploadDefs';

const amountCls = (n: number) => (n < 0 ? 'neg' : '');
const achievementCls = (pct: number) => (pct >= 100 ? 'pos-good' : 'pos-bad');
const badgeCls = (pct: number) => 'badge ' + (pct >= 100 ? 'good' : 'bad');

function BreakdownRows({ rows }: { rows: BreakdownRow[] }) {
  if (!rows.length)
    return (
      <tr className="child empty-child">
        <td>└ No G/L lines for this selection</td>
        <td className="amount">—</td>
      </tr>
    );
  return (
    <>
      {rows.map((r) => (
        <tr className="child" key={r.glAccount}>
          <td title={glLabel(r)}>└ {glLabel(r)}</td>
          <td className="amount">{fmtCurrency(r.amount)}</td>
        </tr>
      ))}
    </>
  );
}

function ExpandableRow({
  label,
  amount,
  rows,
  open,
  onToggle,
  padded
}: {
  label: string;
  amount: number;
  rows: BreakdownRow[];
  open: boolean;
  onToggle: () => void;
  padded?: boolean;
}) {
  return (
    <>
      <tr className={'row click' + (open ? ' hl' : '')} onClick={onToggle}>
        <td style={padded ? { padding: '0 24px' } : undefined}>{open ? '▼' : '▶'} {label}</td>
        <td className="amount">{fmtCurrency(amount)}</td>
      </tr>
      {open && <BreakdownRows rows={rows} />}
    </>
  );
}

function AchievementRow({ label, a }: { label: string; a: Achievement }) {
  return (
    <tr className="row">
      <td>{label}</td>
      <td className="val">{fmtPct(a.actual)}</td>
      <td className="val">{fmtPct(a.target)}</td>
      <td className={'val ' + achievementCls(a.achievementPct)}>{fmtPct(a.achievementPct)}</td>
    </tr>
  );
}

function MissingDataBanner({ missing }: { missing: string[] }) {
  const { canManageData } = useAuth();
  if (!missing.length) return null;
  const names = missing.map((key) => UPLOAD_DEFS.find((d) => d.key === key)?.label || key).join(', ');
  return (
    <div className="banner" role="status">
      <strong>No data yet for: {names}.</strong>{' '}
      {canManageData ? (
        <>
          Upload the missing files on the <Link to="/upload">Upload Data</Link> tab — the figures below are calculated on the server from uploaded data only.
        </>
      ) : (
        'Ask a finance user or administrator to upload them. Figures below are calculated from uploaded data only.'
      )}
    </div>
  );
}

function Dashboard({ data }: { data: DashboardData }) {
  const { kpis: k, allocation, breakdowns } = data;
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const toggle = (key: string) => setOpen((o) => ({ ...o, [key]: !o[key] }));

  return (
    <>
      <MissingDataBanner missing={data.missingDatasets} />
      <div className="hero-grid">
        <div className="hero-card">
          <div className="hero-label">Primary Sales Without Tax</div>
          <div className="hero-value">{fmtCurrency(k.primarySales.actual)}</div>
          <div className="hero-foot">
            <span className="hero-foot-muted">Target {fmtCurrency(k.primarySales.target)}</span>
            <span className={badgeCls(k.primarySales.achievementPct)}>{fmtPct(k.primarySales.achievementPct)}</span>
          </div>
        </div>
        <div className="hero-card">
          <div className="hero-label">Gross Profit</div>
          <div className="hero-value">{fmtCurrency(k.grossProfit)}</div>
          <div className="hero-foot"><span className="hero-foot-muted">Margin {fmtPct(k.grossProfitPct.actual)}</span></div>
        </div>
        <div className="hero-card">
          <div className="hero-label">Operating Profit (EBIT)</div>
          <div className="hero-value">{fmtCurrency(k.ebit)}</div>
          <div className="hero-foot"><span className="hero-foot-muted">Margin {fmtPct(k.ebitPct)}</span></div>
        </div>
        <div className="hero-card">
          <div className="hero-label">Net Profit After Tax</div>
          <div className="hero-value">{fmtCurrency(k.npat)}</div>
          <div className="hero-foot"><span className="hero-foot-muted">NPAT {fmtPct(k.npatPct.actual)}</span></div>
        </div>
      </div>

      <div className="kpi-grid">
        <div className="card">
          <div className="card-title">Cost &amp; Margin Detail</div>
          <table className="kpi">
            <thead><tr><th>KPI</th><th className="amount">Amount</th></tr></thead>
            <tbody>
              <tr className="row"><td>Cost of Goods Sold</td><td className="amount">{fmtCurrency(k.cogs)}</td></tr>
              <tr className="row"><td>Cost of Sales (G/L)</td><td className="amount">{fmtCurrency(k.costOfSalesGL)}</td></tr>
              <tr className="row hl"><td className="bold">Total Cost of Sales</td><td className="amount bold">{fmtCurrency(k.costOfSalesTotal)}</td></tr>
              <tr className="row hl"><td className="bold">Gross Profit</td><td className={'amount bold ' + amountCls(k.grossProfit)}>{fmtCurrency(k.grossProfit)}</td></tr>
            </tbody>
          </table>
          <div className="sub-divider">Margin %</div>
          <table className="kpi">
            <thead><tr><th>KPI</th><th className="val">Actual</th><th className="val">Target</th><th className="val">Achievement</th></tr></thead>
            <tbody><AchievementRow label="Gross Profit %" a={k.grossProfitPct} /></tbody>
          </table>
        </div>

        <div className="card">
          <div className="card-title">Expenses</div>
          <table className="kpi">
            <thead><tr><th>KPI</th><th className="amount">Amount</th></tr></thead>
            <tbody>
              <ExpandableRow label="Sales Performance Incentives" amount={k.expenses.spi} rows={breakdowns.spi} open={!!open.spi} onToggle={() => toggle('spi')} />
              <ExpandableRow label="General Employee Expenses" amount={k.expenses.gee} rows={breakdowns.gee} open={!!open.gee} onToggle={() => toggle('gee')} />
              <tr className="row hl"><td className="bold">Total Employee Related Expenses</td><td className="amount bold">{fmtCurrency(k.expenses.totalEmployeeRelated)}</td></tr>
              <ExpandableRow label="Administration Expenses" amount={k.expenses.admin} rows={breakdowns.admin} open={!!open.admin} onToggle={() => toggle('admin')} />
              <ExpandableRow label="Selling & Distribution Expenses" amount={k.expenses.sd} rows={breakdowns.sd} open={!!open.sd} onToggle={() => toggle('sd')} />
              <ExpandableRow label="Other Expenses" amount={k.expenses.other} rows={breakdowns.other} open={!!open.other} onToggle={() => toggle('other')} />
              <ExpandableRow label="Bad Debtor Provision" amount={k.expenses.badDebt} rows={breakdowns.badDebt} open={!!open.badDebt} onToggle={() => toggle('badDebt')} />
              <tr className="row hl"><td className="bold">Total Operating Expenses</td><td className="amount bold">{fmtCurrency(k.expenses.totalOperationExpenses)}</td></tr>
            </tbody>
          </table>
        </div>

        <div className="card">
          <div className="card-title">Profitability</div>
          <table className="kpi">
            <thead><tr><th>KPI</th><th className="amount">Amount</th></tr></thead>
            <tbody>
              <tr className="row hl"><td className="bold">Operating Profit (EBIT)</td><td className={'amount bold ' + amountCls(k.ebit)}>{fmtCurrency(k.ebit)}</td></tr>
              <tr className="row"><td>Operating Profit % (EBIT %)</td><td className={'amount ' + amountCls(k.ebitPct)}>{fmtPct(k.ebitPct)}</td></tr>
              <ExpandableRow label="Finance Cost" amount={k.financeCost} rows={breakdowns.financeCost} open={!!open.financeCost} onToggle={() => toggle('financeCost')} />
              <tr className="row hl"><td className="bold">Net Profit Before Tax (NPBT)</td><td className={'amount bold ' + amountCls(k.npbt)}>{fmtCurrency(k.npbt)}</td></tr>
              <tr className="row"><td>NPBT %</td><td className={'amount ' + amountCls(k.npbtPct)}>{fmtPct(k.npbtPct)}</td></tr>
              <tr className="row"><td>Corporate Tax (30%)</td><td className="amount">{fmtCurrency(k.corporateTax)}</td></tr>
              <tr className="row hl"><td className="bold">Net Profit After Tax (NPAT)</td><td className={'amount bold ' + amountCls(k.npat)}>{fmtCurrency(k.npat)}</td></tr>
            </tbody>
          </table>
          <div className="sub-divider">NPAT %</div>
          <table className="kpi">
            <thead><tr><th>KPI</th><th className="val">Actual</th><th className="val">Target</th><th className="val">Achievement</th></tr></thead>
            <tbody><AchievementRow label="NPAT %" a={k.npatPct} /></tbody>
          </table>
        </div>
      </div>

      <div className="card flush-top">
        <div className="card-title">Warehouse &amp; Distribution Cost Allocation</div>
        <div className="table-scroll">
          <table className="kpi">
            <thead>
              <tr>
                <th>Channel</th>
                <th className="val">Warehouse Cost</th>
                <th className="val">Distribution Cost</th>
                <th className="val">Warehouse &amp; Delivery Cost</th>
                <th className="val">Debtor Interest</th>
                <th className="val">Electrician Point</th>
                <th className="val">Inventory Interest</th>
              </tr>
            </thead>
            <tbody>
              {allocation.rows.map((r) => (
                <tr className="row" key={r.code}>
                  <td>{r.label}</td>
                  <td className="val">{fmtCurrency(r.warehouseCost)}</td>
                  <td className="val">{fmtCurrency(r.distributionCost)}</td>
                  <td className="val">{fmtCurrency(r.warehouseCost + r.distributionCost)}</td>
                  <td className="val">{fmtCurrency(r.debtorInterest)}</td>
                  <td className="val">{fmtCurrency(r.electricianPoint)}</td>
                  <td className="val">{fmtCurrency(r.inventoryInterest)}</td>
                </tr>
              ))}
              <tr className="row hl">
                <td className="bold">Total</td>
                <td className="val bold">{fmtCurrency(allocation.totals.warehouse)}</td>
                <td className="val bold">{fmtCurrency(allocation.totals.distribution)}</td>
                <td className="val bold">{fmtCurrency(allocation.totals.warehouse + allocation.totals.distribution)}</td>
                <td className="val bold">{fmtCurrency(allocation.totals.debtorInterest)}</td>
                <td className="val bold">{fmtCurrency(allocation.totals.electricianPoint)}</td>
                <td className="val bold">{fmtCurrency(allocation.totals.inventoryInterest)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

export function DashboardPage() {
  const f = useFilters();
  const params = { month: f.month, main: f.main, sub: f.sub, gp: f.gp, npat: f.npat };
  const q = useQuery({
    queryKey: ['dashboard', params],
    queryFn: () => api.dashboard(params),
    placeholderData: (prev) => prev
  });

  const options = q.data?.options;
  const subOptions = (() => {
    if (!options) return [];
    if (f.main !== 'ALL') return options.mainChannels.find((m) => m.main === f.main)?.subs || [];
    return Array.from(new Set(options.mainChannels.flatMap((m) => m.subs))).sort();
  })();

  return (
    <div className="body">
      <div className="filter-bar">
        <div className="filter-group">
          <label className="filter-label" htmlFor="f-month">Month</label>
          <select id="f-month" className="select" value={f.month} onChange={(e) => f.setMonth(e.target.value)}>
            <option value="ALL">All Months (FY26/27)</option>
            {(options?.months || []).map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <div className="filter-group">
          <label className="filter-label" htmlFor="f-main">Main Channel</label>
          <select id="f-main" className="select" value={f.main} onChange={(e) => f.setMain(e.target.value)}>
            <option value="ALL">All Main Channels</option>
            {(options?.mainChannels || []).map((m) => <option key={m.main} value={m.main}>{m.main}</option>)}
          </select>
        </div>
        <div className="filter-group">
          <label className="filter-label" htmlFor="f-sub">Sub Channel</label>
          <select id="f-sub" className="select" value={f.sub} onChange={(e) => f.setSub(e.target.value)}>
            <option value="ALL">All Sub Channels</option>
            {subOptions.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <button className="btn" onClick={f.reset}>Reset</button>
        <div className="spacer" />
        <div className="filter-group narrow">
          <label className="filter-label" htmlFor="f-gp">GP% Target</label>
          <input id="f-gp" className="num-input" type="number" step="0.1" value={f.gp} onChange={(e) => f.setGp(e.target.value)} />
        </div>
        <div className="filter-group narrow">
          <label className="filter-label" htmlFor="f-npat">NPAT% Target</label>
          <input id="f-npat" className="num-input" type="number" step="0.1" value={f.npat} onChange={(e) => f.setNpat(e.target.value)} />
        </div>
      </div>

      <div className="scope-line">
        Showing:{' '}
        <strong>
          {[f.month === 'ALL' ? 'All Months' : f.month, f.main === 'ALL' ? 'All Main Channels' : f.main, f.sub === 'ALL' ? 'All Sub Channels' : f.sub].join(' · ')}
        </strong>
      </div>

      <QueryState isLoading={q.isLoading} error={q.error}>
        {q.data && <Dashboard data={q.data} />}
      </QueryState>
    </div>
  );
}

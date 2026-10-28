import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import type { AppSettings, ExchangeRate, MonthDatasetInfo, PeriodInfo, UploadResult } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { QueryState } from '../components/QueryState';
import { MONTHLY_DEFS, REFERENCE_DEFS, type UploadDef } from './uploadDefs';

type SlotState = { status: 'loading' | 'done' | 'error'; message?: string; result?: UploadResult };

function MiniTable({ header, rows }: { header: string[]; rows: Array<Array<string | number>> }) {
  return (
    <div className="mini-table-wrap">
      <table className="mini-table">
        <thead><tr>{header.map((h, i) => <th key={i}>{h}</th>)}</tr></thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={ri}>{header.map((_, ci) => <td key={ci}>{r[ci] === undefined || r[ci] === '' ? '—' : String(r[ci])}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FormatPanel({ def }: { def: UploadDef }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="link-btn" onClick={() => setOpen((v) => !v)}>{open ? 'Hide expected format ▲' : 'View expected format ▼'}</button>
      {open && (
        <div className="format-panel">
          <div className="settings-label">Expected format</div>
          <MiniTable header={def.columns} rows={def.sample.map((r) => [...r, ...Array(Math.max(0, def.columns.length - r.length)).fill('...')])} />
          {def.note && <div className="settings-hint">{def.note}</div>}
        </div>
      )}
    </>
  );
}

/** Saves a settings patch shortly after the last edit. */
function useDebouncedSave<T>(save: (patch: T) => void) {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (patch: T) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => save(patch), 700);
  };
}

function useRefresh() {
  const queryClient = useQueryClient();
  return () => {
    for (const key of ['uploads', 'periods', 'dashboard', 'comparison', 'ytd']) void queryClient.invalidateQueries({ queryKey: [key] });
  };
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong.');
const fmtWhen = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : '');

// ---------------------------------------------------------------------------
// Reference data (not month-specific)
// ---------------------------------------------------------------------------

function SurchargeBox({ settings, save }: { settings: AppSettings; save: (p: Partial<AppSettings>) => void }) {
  const [value, setValue] = useState(settings.mm60SurchargePct.toFixed(3));
  const debounced = useDebouncedSave(save);
  return (
    <div className="settings-box">
      <div className="settings-label">MM60 Surcharge %</div>
      <input
        className="num-input w100"
        type="number"
        step="0.001"
        value={value}
        onChange={(e) => { setValue(e.target.value); debounced({ mm60SurchargePct: parseFloat(e.target.value) || 0 }); }}
        onBlur={() => setValue((parseFloat(value) || 0).toFixed(3))}
      />
      <div className="settings-hint">Applied to MM60 price before COGS: Adjusted Price = MM60 Price × (1 + Surcharge%). Update whenever MM60 data changes. Not applied to materials costed via VK13 (Material Type FERT/HALB).</div>
    </div>
  );
}

function ExchangeRateBox({ settings, save }: { settings: AppSettings; save: (p: Partial<AppSettings>) => void }) {
  const [rates, setRates] = useState<ExchangeRate[]>(settings.vk13ExchangeRates);
  const debounced = useDebouncedSave(save);
  const update = (next: ExchangeRate[]) => { setRates(next); debounced({ vk13ExchangeRates: next }); };
  return (
    <div className="settings-box">
      <div className="settings-label">Currency Exchange Rate Setup</div>
      {rates.map((r, i) => (
        <div className="rate-row" key={i}>
          <input className="num-input cur" value={r.currency} placeholder="Currency" onChange={(e) => update(rates.map((x, j) => (j === i ? { ...x, currency: e.target.value.toUpperCase() } : x)))} />
          <input className="num-input w100" type="number" step="0.01" value={r.rate} onChange={(e) => update(rates.map((x, j) => (j === i ? { ...x, rate: e.target.value } : x)))} />
          <button className="btn small" aria-label="Remove currency" onClick={() => update(rates.filter((_, j) => j !== i))}>✕</button>
        </div>
      ))}
      <button className="link-btn" onClick={() => update([...rates, { currency: '', rate: '0.00' }])}>+ Add Currency</button>
      <div className="settings-hint">Applied to non-LKR VK13 rows before COGS, per each row's actual currency: LKR Amount = Amount × Exchange Rate for that currency, then Local Currency Price = LKR Amount ÷ per. LKR-priced rows are unaffected. Update whenever VK13 data or rates change.</div>
    </div>
  );
}

function ReferenceCard({ def, settings, saveSettings }: { def: UploadDef; settings: AppSettings; saveSettings: (p: Partial<AppSettings>) => void }) {
  const refresh = useRefresh();
  const status = useQuery({ queryKey: ['uploads'], queryFn: api.uploads });
  const [slot, setSlot] = useState<SlotState | null>(null);

  const dataset = status.data?.datasets[def.key];
  const loaded = !!dataset && !dataset.removed;
  const validation = def.key === 'costCenters' ? status.data?.costCenterValidation : null;

  async function onFile(file: File) {
    setSlot({ status: 'loading' });
    try {
      const result = await api.upload(def.key, file);
      setSlot({ status: 'done', result });
      refresh();
    } catch (err) {
      setSlot({ status: 'error', message: errorText(err) });
    }
  }

  const remove = useMutation({ mutationFn: () => api.removeUpload(def.key), onSuccess: () => { setSlot(null); refresh(); } });

  const chip = slot?.status === 'loading' ? ['Parsing…', ''] : slot?.status === 'error' ? ['Error', 'error'] : loaded ? ['Loaded', 'done'] : ['No data', ''];
  const preview = slot?.status === 'done' ? slot.result?.preview : undefined;

  return (
    <div className="upload-card">
      <div className="upload-head">
        <div>
          <div className="upload-name">{def.label}</div>
          <div className="upload-cadence">{def.cadence}</div>
        </div>
        <div className={'status-chip ' + chip[1]}>{chip[0]}</div>
      </div>
      <div className="upload-file">
        {loaded
          ? `${dataset!.fileName || 'Uploaded file'} · ${dataset!.rowCount.toLocaleString()} rows · ${fmtWhen(dataset!.uploadedAt)}${dataset!.uploadedBy ? ' · ' + dataset!.uploadedBy : ''}`
          : def.key === 'distExclusion' ? 'Using built-in default list' : 'Not loaded'}
      </div>
      <div className="upload-actions">
        <label className={'file-btn' + (slot?.status === 'loading' ? ' disabled' : '')}>
          Choose file
          <input
            type="file"
            accept={def.accept}
            hidden
            disabled={slot?.status === 'loading'}
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void onFile(f); }}
          />
        </label>
        {def.removable && loaded && (
          <button className="btn small danger" disabled={remove.isPending} onClick={() => window.confirm(`Remove the ${def.label} data?`) && remove.mutate()}>Remove</button>
        )}
      </div>

      {slot?.status === 'error' && <div className="msg error" role="alert">⚠ {slot.message}</div>}
      {def.key === 'costCenters' && validation && (
        <div className="msg success">
          ✓ Cost Centers file uploaded successfully — {validation.uniqueCount} unique cost center{validation.uniqueCount === 1 ? '' : 's'} loaded. Matched {validation.matchedRows} of {validation.validTransactionRows} valid Company Code 1100/1600 rows
          {validation.unmatchedCount ? ` (${validation.unmatchedCount} unmatched cost center${validation.unmatchedCount === 1 ? '' : 's'})` : ''}.
        </div>
      )}
      {def.key === 'costCenters' && !validation && <div className="msg notice">Upload a valid Cost Centers file before calculating Product Company expenses.</div>}

      {def.showExchangeRateInput && <ExchangeRateBox settings={settings} save={saveSettings} />}
      {def.showSurchargeInput && <SurchargeBox settings={settings} save={saveSettings} />}

      {preview && (
        <div style={{ marginTop: 12 }}>
          <div className="settings-label">Uploaded file preview</div>
          <MiniTable header={preview.header} rows={preview.rows} />
        </div>
      )}
      <FormatPanel def={def} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Monthly data: choose a month, upload that month's files, lock the month
// ---------------------------------------------------------------------------

function MonthlyCard({ def, period, info }: { def: UploadDef; period: PeriodInfo; info: MonthDatasetInfo }) {
  const refresh = useRefresh();
  const locked = period.status === 'locked';
  const [slot, setSlot] = useState<SlotState | null>(null);

  // A different month means a different slot: forget the previous month's result message.
  useEffect(() => setSlot(null), [period.month]);

  async function onFile(file: File) {
    setSlot({ status: 'loading' });
    try {
      const result = await api.upload(def.key, file, period.month);
      setSlot({ status: 'done', result });
      refresh();
    } catch (err) {
      setSlot({ status: 'error', message: errorText(err) });
      refresh(); // the month may have been locked meanwhile
    }
  }
  const remove = useMutation({
    mutationFn: () => api.removeUpload(def.key, period.month),
    onSuccess: () => { setSlot(null); refresh(); },
    onError: (e) => setSlot({ status: 'error', message: errorText(e) })
  });

  const loaded = info.rowCount > 0;
  const chip = slot?.status === 'loading' ? ['Parsing…', ''] : slot?.status === 'error' ? ['Error', 'error'] : loaded ? ['Loaded', 'done'] : ['No data', ''];
  const preview = slot?.status === 'done' ? slot.result?.preview : undefined;
  const ignored = Number(slot?.result?.meta.ignoredOutsideMonth ?? slot?.result?.meta.ignoredOtherMonths ?? 0);

  return (
    <div className="upload-card">
      <div className="upload-head">
        <div>
          <div className="upload-name">{def.label}</div>
          <div className="upload-cadence">{period.label}</div>
        </div>
        <div className={'status-chip ' + chip[1]}>{chip[0]}</div>
      </div>
      <div className="upload-file">
        {loaded
          ? `${info.fileName || 'Uploaded file'} · ${info.rowCount.toLocaleString()} rows · ${fmtWhen(info.uploadedAt)}${info.uploadedBy ? ' · ' + info.uploadedBy : ''}`
          : `Nothing uploaded for ${period.month} yet`}
      </div>
      <div className="upload-actions">
        <label className={'file-btn' + (locked || slot?.status === 'loading' ? ' disabled' : '')} title={locked ? `${period.label} is locked` : undefined}>
          {loaded ? 'Replace file' : 'Choose file'}
          <input
            type="file"
            accept={def.accept}
            hidden
            disabled={locked || slot?.status === 'loading'}
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void onFile(f); }}
          />
        </label>
        {loaded && (
          <button
            className="btn small danger"
            disabled={locked || remove.isPending}
            onClick={() => window.confirm(`Remove the ${def.label} data for ${period.label}?`) && remove.mutate()}
          >
            Remove
          </button>
        )}
      </div>

      {slot?.status === 'error' && <div className="msg error" role="alert">⚠ {slot.message}</div>}
      {slot?.status === 'done' && slot.result && (
        <div className="msg success">
          ✓ {slot.result.rowCount.toLocaleString()} row{slot.result.rowCount === 1 ? '' : 's'} imported for {period.label}.
          {ignored > 0 && ` ${ignored.toLocaleString()} row${ignored === 1 ? '' : 's'} from other months in the file ${ignored === 1 ? 'was' : 'were'} ignored.`}
        </div>
      )}
      {preview && (
        <div style={{ marginTop: 12 }}>
          <div className="settings-label">Uploaded file preview</div>
          <MiniTable header={preview.header} rows={preview.rows} />
        </div>
      )}
      <FormatPanel def={def} />
    </div>
  );
}

function ElectricianPointBox({ period }: { period: PeriodInfo }) {
  const refresh = useRefresh();
  const locked = period.status === 'locked';
  const [value, setValue] = useState(String(period.electricianPoint));
  const [error, setError] = useState('');
  useEffect(() => { setValue(String(period.electricianPoint)); setError(''); }, [period.month, period.electricianPoint]);
  const save = useMutation({
    mutationFn: (v: number) => api.setElectricianPoint(period.month, v),
    onSuccess: () => { setError(''); refresh(); },
    onError: (e) => { setError(errorText(e)); refresh(); }
  });
  const debounced = useDebouncedSave<number>((v) => save.mutate(v));
  return (
    <div className="inline-card">
      <div className="upload-name">Electrician Point — {period.label}</div>
      <input
        className="num-input"
        style={{ width: 200, marginTop: 10 }}
        type="number"
        step="0.01"
        min="0"
        disabled={locked}
        value={value}
        onChange={(e) => { setValue(e.target.value); debounced(parseFloat(e.target.value) || 0); }}
      />
      <div className="settings-hint">Manually entered amount for {period.month}, split across Direct Dealer, Distributor and Wireman, Ruhunu &amp; PVC by Target %.</div>
      {error && <div className="msg error" role="alert">⚠ {error}</div>}
    </div>
  );
}

function MonthlySection({ periods }: { periods: PeriodInfo[] }) {
  const { canManageData, isAdmin } = useAuth();
  const refresh = useRefresh();
  // Start on the latest month that has data (otherwise April), so the person lands where they are working.
  const [month, setMonth] = useState(() => [...periods].reverse().find((p) => Object.values(p.data).some((d) => d.rowCount > 0))?.month ?? periods[0].month);
  const [error, setError] = useState('');
  const period = periods.find((p) => p.month === month) ?? periods[0];
  const locked = period.status === 'locked';

  const lock = useMutation({
    mutationFn: () => api.lockPeriod(period.month),
    onSuccess: () => { setError(''); refresh(); },
    onError: (e) => { setError(errorText(e)); refresh(); }
  });
  const unlock = useMutation({
    mutationFn: (note: string) => api.unlockPeriod(period.month, note || undefined),
    onSuccess: () => { setError(''); refresh(); },
    onError: (e) => { setError(errorText(e)); refresh(); }
  });

  function onLock() {
    const ok = window.confirm(
      `Lock ${period.label}?\n\nAfter locking, nobody can upload, replace, remove or edit this month's data until an administrator unlocks it.`
    );
    if (ok) lock.mutate();
  }
  function onUnlock() {
    const note = window.prompt(`Unlock ${period.label}? Add a reason for the audit trail (optional):`);
    if (note !== null) unlock.mutate(note);
  }

  return (
    <section aria-labelledby="monthly-title">
      <div className="intro">
        <h2 id="monthly-title">Monthly data</h2>
        <p>Choose the month first, then upload that month's files. Each upload replaces only the selected month. When the month is complete, lock it to prevent any further changes.</p>
      </div>

      <div className="filter-bar" style={{ marginBottom: 16 }}>
        <div className="filter-group">
          <label className="filter-label" htmlFor="u-month">Month</label>
          <select id="u-month" className="select" value={period.month} onChange={(e) => { setMonth(e.target.value); setError(''); }}>
            {periods.map((p) => (
              <option key={p.month} value={p.month}>
                {p.label}{p.status === 'locked' ? '  🔒 Locked' : Object.values(p.data).some((d) => d.rowCount > 0) ? '  · has data' : ''}
              </option>
            ))}
          </select>
        </div>
        <div className="filter-group">
          <span className="filter-label">Status</span>
          <span className={'status-chip ' + (locked ? 'error' : 'done')} style={{ alignSelf: 'flex-start', padding: '9px 14px' }}>{locked ? '🔒 Locked' : 'Open'}</span>
        </div>
        <div className="spacer" />
        {canManageData && !locked && (
          <button className="btn" onClick={onLock} disabled={lock.isPending}>🔒 Lock {period.month}</button>
        )}
        {isAdmin && locked && (
          <button className="btn" onClick={onUnlock} disabled={unlock.isPending}>🔓 Unlock {period.month}</button>
        )}
      </div>

      {locked && (
        <div className="msg notice" role="status" style={{ marginBottom: 16 }}>
          🔒 {period.label} is locked{period.lockedBy ? ` by ${period.lockedBy}` : ''}{period.lockedAt ? ` on ${fmtWhen(period.lockedAt)}` : ''}. Uploads, replacements, removals and edits are disabled.{' '}
          {isAdmin ? 'Use Unlock to reopen it.' : 'Only an administrator can unlock it.'}
        </div>
      )}
      {!locked && period.lastEvent?.action === 'unlock' && (
        <div className="msg notice" style={{ marginBottom: 16 }}>
          Unlocked by {period.lastEvent.by ?? 'an administrator'} on {fmtWhen(period.lastEvent.at)}{period.lastEvent.note ? ` — “${period.lastEvent.note}”` : ''}. Re-lock it once the corrections are done.
        </div>
      )}
      {error && <div className="msg error" role="alert" style={{ marginBottom: 16 }}>⚠ {error}</div>}

      <div className="upload-grid">
        {MONTHLY_DEFS.map((def) => (
          <MonthlyCard key={def.key} def={def} period={period} info={period.data[def.key as keyof PeriodInfo['data']]} />
        ))}
      </div>
      <ElectricianPointBox period={period} />
    </section>
  );
}

// ---------------------------------------------------------------------------

export function UploadPage() {
  const refresh = useRefresh();
  const settings = useQuery({ queryKey: ['settings'], queryFn: api.settings });
  const periods = useQuery({ queryKey: ['periods'], queryFn: api.periods });
  const [saved, setSaved] = useState('');
  const mutate = useMutation({
    mutationFn: (patch: Partial<AppSettings>) => api.updateSettings(patch),
    onSuccess: () => {
      setSaved('Settings saved');
      refresh();
      setTimeout(() => setSaved(''), 2500);
    },
    onError: (e) => setSaved(errorText(e))
  });

  return (
    <div className="body">
      <QueryState isLoading={periods.isLoading} error={periods.error}>
        {periods.data && <MonthlySection periods={periods.data.periods} />}
      </QueryState>

      <section aria-labelledby="reference-title" style={{ marginTop: 36 }}>
        <div className="intro">
          <h2 id="reference-title">Reference data</h2>
          <p>
            Files that are not tied to a single month — Target, G/L mapping, MM60, VK13, Cost Centers and the exclusion list. They apply to every month and can be replaced independently; locking a month does not freeze them, so change them with care. Large files (MM60, VK13) can take up to a minute to process.
          </p>
          {saved && <p role="status" style={{ marginTop: 6, color: 'var(--good)' }}>{saved}</p>}
        </div>
        <QueryState isLoading={settings.isLoading} error={settings.error}>
          {settings.data && (
            <div className="upload-grid">
              {REFERENCE_DEFS.map((def) => (
                <ReferenceCard key={def.key} def={def} settings={settings.data.settings} saveSettings={(p) => mutate.mutate(p)} />
              ))}
            </div>
          )}
        </QueryState>
      </section>
    </div>
  );
}

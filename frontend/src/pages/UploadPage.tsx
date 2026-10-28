import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import type { AppSettings, ExchangeRate, UploadResult } from '../api/types';
import { QueryState } from '../components/QueryState';
import { UPLOAD_DEFS, type UploadDef } from './uploadDefs';

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

/** Saves a settings patch shortly after the last edit, like the original's instant recalculation. */
function useDebouncedSave(save: (patch: Partial<AppSettings>) => void) {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (patch: Partial<AppSettings>) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => save(patch), 700);
  };
}

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

function UploadCard({ def, settings, saveSettings }: { def: UploadDef; settings: AppSettings; saveSettings: (p: Partial<AppSettings>) => void }) {
  const queryClient = useQueryClient();
  const status = useQuery({ queryKey: ['uploads'], queryFn: api.uploads });
  const [slot, setSlot] = useState<SlotState | null>(null);
  const [showFormat, setShowFormat] = useState(false);

  const dataset = status.data?.datasets[def.key];
  const loaded = !!dataset && !dataset.removed;
  const validation = def.key === 'costCenters' ? status.data?.costCenterValidation : null;

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['uploads'] });
    void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
  };

  async function onFile(file: File) {
    setSlot({ status: 'loading' });
    try {
      const result = await api.upload(def.key, file);
      setSlot({ status: 'done', result });
      refresh();
    } catch (err) {
      setSlot({ status: 'error', message: err instanceof Error ? err.message : 'Could not read this file.' });
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
          ? `${dataset!.fileName || 'Uploaded file'} · ${dataset!.rowCount.toLocaleString()} rows · ${new Date(dataset!.uploadedAt).toLocaleString()}${dataset!.uploadedBy ? ' · ' + dataset!.uploadedBy : ''}`
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

      <button className="link-btn" onClick={() => setShowFormat((v) => !v)}>{showFormat ? 'Hide expected format ▲' : 'View expected format ▼'}</button>
      {showFormat && (
        <div className="format-panel">
          <div className="settings-label">Expected format</div>
          <MiniTable header={def.columns} rows={def.sample.map((r) => [...r, ...Array(Math.max(0, def.columns.length - r.length)).fill('...')])} />
          {def.note && <div className="settings-hint">{def.note}</div>}
        </div>
      )}
    </div>
  );
}

function ElectricianPoint({ settings, save }: { settings: AppSettings; save: (p: Partial<AppSettings>) => void }) {
  const [value, setValue] = useState(String(settings.electricianPoint));
  const debounced = useDebouncedSave(save);
  return (
    <div className="inline-card">
      <div className="upload-name">Electrician Point</div>
      <input
        className="num-input"
        style={{ width: 200, marginTop: 10 }}
        type="number"
        step="0.01"
        value={value}
        onChange={(e) => { setValue(e.target.value); debounced({ electricianPoint: parseFloat(e.target.value) || 0 }); }}
      />
      <div className="settings-hint">Manually entered amount, split across Direct Dealer, Distributor and Wireman, Ruhunu &amp; PVC by Target %.</div>
    </div>
  );
}

export function UploadPage() {
  const queryClient = useQueryClient();
  const settings = useQuery({ queryKey: ['settings'], queryFn: api.settings });
  const [saved, setSaved] = useState('');
  const mutate = useMutation({
    mutationFn: (patch: Partial<AppSettings>) => api.updateSettings(patch),
    onSuccess: () => {
      setSaved('Settings saved');
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      setTimeout(() => setSaved(''), 2500);
    },
    onError: (e) => setSaved(e instanceof Error ? e.message : 'Could not save settings')
  });

  return (
    <div className="body">
      <div className="intro">
        <h2>Upload data files</h2>
        <p>Replace any file independently — yearly files (Target, GL Mapping, mm60 Item Cost, VK13 Pricing) rarely change; monthly files (Sales Report, Expenses Report) update regularly. The dashboard recomputes automatically after each upload. Large files (MM60, VK13) can take up to a minute to process.</p>
        {saved && <p role="status" style={{ marginTop: 6, color: 'var(--good)' }}>{saved}</p>}
      </div>
      <QueryState isLoading={settings.isLoading} error={settings.error}>
        {settings.data && (
          <>
            <div className="upload-grid">
              {UPLOAD_DEFS.map((def) => (
                <UploadCard key={def.key} def={def} settings={settings.data.settings} saveSettings={(p) => mutate.mutate(p)} />
              ))}
            </div>
            <ElectricianPoint settings={settings.data.settings} save={(p) => mutate.mutate(p)} />
          </>
        )}
      </QueryState>
    </div>
  );
}

import React, { useEffect, useState } from 'react';
import { apiGet, apiPut } from '../api';
import { apiDexList, DexListItem } from '../api';

type Settings = {
  version: 1;
  updated_at?: string;
  format: string;
  epochs: number;
  snapshotEvery: number;
  opponentPool: string[];
  seed: number;
  battlesPerBatch: number;
  timeoutMs: number;
};

export default function SettingsPage() {
  const [cfg, setCfg] = useState<Settings | null>(null);
  const [err, setErr] = useState('');
  const [saveMsg, setSaveMsg] = useState('');
  const [formats, setFormats] = useState<DexListItem[]>([]);

  useEffect(() => {
    apiGet<Settings>('/api/config/settings')
      .then((r) => setCfg(r))
      .catch((e) => setErr(String(e?.message ?? e)));
  }, []);

  useEffect(() => {
    let cancelled = false;
    apiDexList('formats', { only: 'vgc' })
      .then((r) => {
        if (!cancelled) setFormats(r.items);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  if (!cfg) return <div>loading...</div>;

  return (
    <div>
      <h2 style={{ margin: '8px 0 12px' }}>/settings</h2>
      <div style={{ marginBottom: 8, color: '#666' }}>保存先: config/pokemon-showdown/vgc-demo/train_settings.json</div>
      {err ? <div style={{ color: 'crimson' }}>{err}</div> : null}
      {saveMsg ? <div style={{ color: 'green' }}>{saveMsg}</div> : null}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }}>
        <label>
          format
          <br />
          <select
            value={cfg.format ?? ''}
            onChange={(e) => setCfg({ ...cfg, format: e.target.value })}
            style={{ width: '100%', padding: '6px 8px', border: '1px solid #ccc', borderRadius: 6, background: 'white' }}
          >
            <option value="">(select)</option>
            {formats.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </label>
        <label>epochs<br /><input value={cfg.epochs} onChange={(e) => setCfg({ ...cfg, epochs: Number(e.target.value) })} /></label>
        <label>snapshotEvery<br /><input value={cfg.snapshotEvery} onChange={(e) => setCfg({ ...cfg, snapshotEvery: Number(e.target.value) })} /></label>
        <label>seed<br /><input value={cfg.seed} onChange={(e) => setCfg({ ...cfg, seed: Number(e.target.value) })} /></label>
        <label>battlesPerBatch<br /><input value={cfg.battlesPerBatch} onChange={(e) => setCfg({ ...cfg, battlesPerBatch: Number(e.target.value) })} /></label>
        <label>timeoutMs<br /><input value={cfg.timeoutMs} onChange={(e) => setCfg({ ...cfg, timeoutMs: Number(e.target.value) })} /></label>
      </div>

      <div style={{ marginTop: 12 }}>
        <label>
          opponentPool (1行1要素)
          <br />
          <textarea
            rows={6}
            style={{ width: '100%' }}
            value={(cfg.opponentPool ?? []).join('\n')}
            onChange={(e) => setCfg({ ...cfg, opponentPool: e.target.value.split(/\r?\n/).map((s) => s.trim()).filter(Boolean) })}
          />
        </label>
      </div>

      <div style={{ marginTop: 12 }}>
        <button
          onClick={() => {
            setErr('');
            setSaveMsg('');
            apiPut<Settings>('/api/config/settings', cfg)
              .then((saved) => {
                setCfg(saved);
                setSaveMsg('Saved');
              })
              .catch((e) => setErr(String(e?.message ?? e)));
          }}
        >
          Save
        </button>
      </div>
    </div>
  );
}

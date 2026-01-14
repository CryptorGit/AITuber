import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { AssetEntry, BgmEntry, CharacterProfile, DoctorStatus } from '../api.ts';
import { getAssets, createProject, getDoctor, assetMediaUrl } from '../api.ts';

export default function AssetsPage() {
  const navigate = useNavigate();
  const [assets, setAssets] = useState<AssetEntry[]>([]);
  const [bgm, setBgm] = useState<BgmEntry[]>([]);
  const [characters, setCharacters] = useState<CharacterProfile[]>([]);
  const [selected, setSelected] = useState<AssetEntry | null>(null);
  const [selectedBattleId, setSelectedBattleId] = useState<string>('');
  const [selectedBgm, setSelectedBgm] = useState<string>('');
  const [selectedCharacter, setSelectedCharacter] = useState<string>('');
  const [newProjectId, setNewProjectId] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [doctor, setDoctor] = useState<DoctorStatus[]>([]);
  const [assetLogs, setAssetLogs] = useState<{ battle: string }>({ battle: '' });
  const [assetLogsErr, setAssetLogsErr] = useState<string | null>(null);

  const load = async (refresh?: boolean) => {
    setLoading(true);
    setError(null);
    try {
      const data = await getAssets(refresh);
      setAssets(data.registry.assets);
      setBgm(data.bgm);
      setCharacters(data.characters);
      if ((!selectedBattleId && !selected) && data.registry.assets.length) {
        const first = data.registry.assets[0];
        setSelected(first);
        setSelectedBattleId(first.battle_id);
      }
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setLoading(false);
    }
  };

  const loadDoctor = async () => {
    try {
      const data = await getDoctor();
      setDoctor(data.statuses);
    } catch {
      setDoctor([]);
    }
  };

  useEffect(() => {
    void load();
    void loadDoctor();
  }, []);

  useEffect(() => {
    if (!selectedBattleId) return;
    const next = assets.find((a) => a.battle_id === selectedBattleId) || null;
    setSelected(next);
  }, [selectedBattleId, assets]);

  useEffect(() => {
    if (!selected) return;
    if (selectedBattleId && selectedBattleId === selected.battle_id) return;
    setSelectedBattleId(selected.battle_id);
  }, [selected?.battle_id]);

  useEffect(() => {
    if (!selected) {
      setAssetLogs({ battle: '' });
      setAssetLogsErr(null);
      return;
    }
    let canceled = false;
    setAssetLogsErr(null);
    const loadLogs = async () => {
      const battleUrl = selected.ts_log ? assetMediaUrl(selected.battle_id, 'ts_log') : null;
      try {
        const battleText = await (battleUrl ? fetch(battleUrl).then((r) => (r.ok ? r.text() : '')) : Promise.resolve(''));
        if (canceled) return;
        setAssetLogs({ battle: battleText || '' });
      } catch (e: any) {
        if (canceled) return;
        setAssetLogsErr(String(e?.message ?? e));
        setAssetLogs({ battle: '' });
      }
    };
    void loadLogs();
    return () => {
      canceled = true;
    };
  }, [selected?.battle_id]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return assets;
    return assets.filter((asset) => asset.battle_id.toLowerCase().includes(q));
  }, [assets, query]);

  const canCreate = Boolean(selected?.base_mp4 && selected?.ts_log);

  const onCreate = async () => {
    if (!selected) return;
    try {
      setLoading(true);
      const project = await createProject({
        project_id: newProjectId.trim() || undefined,
        battle_id: selected.battle_id,
        bgm_path: selectedBgm || null,
        character_id: selectedCharacter || null,
      });
      setNewProjectId('');
      navigate(`/projects/${project.project_id}`);
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="panel-grid">
      <div className="panel">
        <div className="panel-header">
          <div>
            <h2>アセット</h2>
            <p>battle_id を選ぶと mp4 / battle_log（*.battlelog.jsonl）が自動で紐づきます。</p>
          </div>
          <button className="ghost" onClick={() => load(true)} disabled={loading}>
            再読み込み
          </button>
        </div>

        <div className="detail-stack">
          <div className="detail">
            <span className="label">battle_id</span>
            <select
              className="input"
              value={selectedBattleId}
              onChange={(e) => setSelectedBattleId(e.target.value)}
            >
              <option value="">(select)</option>
              {assets.map((asset) => (
                <option key={asset.battle_id} value={asset.battle_id}>
                  {asset.battle_id}
                </option>
              ))}
            </select>
          </div>

          <div className="detail">
            <span className="label">search</span>
            <input
              className="input"
              placeholder="battle_id をフィルタ"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && filtered.length) {
                  setSelectedBattleId(filtered[0].battle_id);
                }
              }}
            />
          </div>

          <div className="asset-list">
            {filtered.slice(0, 80).map((asset) => (
              <button
                key={asset.battle_id}
                className={`asset-card ${selected?.battle_id === asset.battle_id ? 'active' : ''}`}
                onClick={() => setSelectedBattleId(asset.battle_id)}
              >
                <div className="asset-title">{asset.battle_id}</div>
                <div className="asset-meta">
                  <span className={asset.base_mp4 ? 'ok' : 'warn'}>base_mp4</span>
                  <span className={asset.battle_log ? 'ok' : 'warn'}>battle_log</span>
                  <span className={asset.ts_log ? 'ok' : 'warn'}>ts_log</span>
                </div>
              </button>
            ))}
            {!filtered.length && <div className="empty">No assets found</div>}
          </div>

          <div className="hint">
            {query.trim() ? `表示: ${filtered.length} 件` : `全件: ${assets.length} 件`}
          </div>
        </div>
      </div>

      <div className="panel highlight">
        <div className="panel-header">
          <div>
            <h2>プロジェクト作成</h2>
            <p>入力を確認して、BGM / キャラを選びます。</p>
          </div>
        </div>

        {selected ? (
          <div className="detail-stack">
            <div className="detail">
              <span className="label">battle_id</span>
              <span>{selected.battle_id}</span>
            </div>
            <div className="detail-grid">
              <div className="detail">
                <span className="label">base_mp4</span>
                <span className={selected.base_mp4 ? 'ok' : 'asset-missing'}>{selected.base_mp4 ? 'OK' : 'missing'}</span>
              </div>
              <div className="detail">
                <span className="label">battle_log</span>
                <span className={selected.ts_log ? 'ok' : 'asset-missing'}>{selected.ts_log ? 'OK' : 'missing'}</span>
              </div>
            </div>

            <div className="panel soft">
              <div className="panel-header">
                <h3>プレビュー</h3>
              </div>
              {selected.base_mp4 ? (
                <video
                  style={{ width: '100%', borderRadius: 10 }}
                  controls
                  preload="metadata"
                  src={assetMediaUrl(selected.battle_id, 'base_mp4')}
                />
              ) : (
                <div className="empty">base_mp4 missing</div>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 8, marginTop: 10 }}>
                <details>
                  <summary>battle_log（表示）</summary>
                  {selected.ts_log ? (
                    <pre className="code-block" style={{ maxHeight: 240, overflow: 'auto' }}>
                      {assetLogs.battle || '(empty)'}
                    </pre>
                  ) : (
                    <div className="empty">battle_log missing</div>
                  )}
                </details>
                {assetLogsErr && <div className="error">{assetLogsErr}</div>}
              </div>
            </div>

            <div className="detail">
              <span className="label">bgm_mp3</span>
              <select className="input" value={selectedBgm} onChange={(e) => setSelectedBgm(e.target.value)}>
                <option value="">(none)</option>
                {bgm.map((track) => (
                  <option key={track.path} value={track.path}>
                    {track.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="detail">
              <span className="label">live2d model（character）</span>
              <select className="input" value={selectedCharacter} onChange={(e) => setSelectedCharacter(e.target.value)}>
                {characters.map((char) => (
                  <option key={char.character_id} value={char.character_id}>
                    {char.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="detail">
              <span className="label">project name（optional）</span>
              <input
                className="input"
                placeholder="例: my_project_01"
                value={newProjectId}
                onChange={(e) => setNewProjectId(e.target.value)}
              />
              <div className="hint">未入力の場合は自動生成されます（battle_id + timestamp）。</div>
            </div>

            <button className="primary" onClick={onCreate} disabled={!canCreate || loading}>
              プロジェクト作成
            </button>
            {error && <div className="error">{error}</div>}
            {!canCreate && <div className="hint">base_mp4 と ts_log/battle_log のどちらかが必要です</div>}
          </div>
        ) : (
          <div className="empty">アセットを選択してください</div>
        )}

        <div className="panel soft">
          <details>
            <summary style={{ cursor: 'pointer', fontWeight: 700 }}>環境チェック</summary>
            <div style={{ marginTop: 10 }}>
              <div className="panel-actions" style={{ marginBottom: 10 }}>
                <button className="ghost" onClick={loadDoctor}>
                  再チェック
                </button>
              </div>
              <div className="doctor-list">
                {doctor.map((item) => (
                  <div key={item.name} className={`doctor-item ${item.ok ? 'ok' : 'warn'}`}>
                    <span>{item.name}</span>
                    <span>{item.message}</span>
                  </div>
                ))}
                {!doctor.length && <div className="empty">チェック結果が取得できません</div>}
              </div>
            </div>
          </details>
        </div>
      </div>
    </section>
  );
}

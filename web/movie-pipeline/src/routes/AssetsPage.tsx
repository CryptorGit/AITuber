import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { AssetEntry, BgmEntry, CharacterProfile, DoctorStatus } from '../api.ts';
import { getAssets, createProject, getDoctor } from '../api.ts';

export default function AssetsPage() {
  const navigate = useNavigate();
  const [assets, setAssets] = useState<AssetEntry[]>([]);
  const [bgm, setBgm] = useState<BgmEntry[]>([]);
  const [characters, setCharacters] = useState<CharacterProfile[]>([]);
  const [selected, setSelected] = useState<AssetEntry | null>(null);
  const [selectedBgm, setSelectedBgm] = useState<string>('');
  const [selectedCharacter, setSelectedCharacter] = useState<string>('builtin_simple');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [doctor, setDoctor] = useState<DoctorStatus[]>([]);

  const load = async (refresh?: boolean) => {
    setLoading(true);
    setError(null);
    try {
      const data = await getAssets(refresh);
      setAssets(data.registry.assets);
      setBgm(data.bgm);
      setCharacters(data.characters);
      if (!selected && data.registry.assets.length) {
        setSelected(data.registry.assets[0]);
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

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return assets;
    return assets.filter((asset) => asset.battle_id.toLowerCase().includes(q));
  }, [assets, query]);

  const canCreate = Boolean(selected?.base_mp4 && selected?.battle_log);

  const onCreate = async () => {
    if (!selected) return;
    try {
      setLoading(true);
      const project = await createProject({
        battle_id: selected.battle_id,
        bgm_path: selectedBgm || null,
        character_id: selectedCharacter || 'builtin_simple',
      });
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
            <h2>Assets</h2>
            <p>Select a battle_id to auto-link logs.</p>
          </div>
          <button className="ghost" onClick={() => load(true)} disabled={loading}>
            Refresh
          </button>
        </div>

        <div className="search-row">
          <input
            className="input"
            placeholder="Search battle_id"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        <div className="asset-list">
          {filtered.map((asset) => {
            const missing = !asset.base_mp4 || !asset.battle_log;
            const active = selected?.battle_id === asset.battle_id;
            return (
              <button
                key={asset.battle_id}
                className={`asset-card ${active ? 'active' : ''}`}
                onClick={() => setSelected(asset)}
              >
                <div className="asset-title">{asset.battle_id}</div>
                <div className="asset-meta">
                  <span className={asset.base_mp4 ? 'ok' : 'warn'}>base_mp4</span>
                  <span className={asset.battle_log ? 'ok' : 'warn'}>battle_log</span>
                  <span className={asset.ts_log ? 'ok' : 'warn'}>ts_log</span>
                </div>
                <div className="asset-meta">
                  <span>turns: {asset.turns ?? '-'}</span>
                  <span>winner: {asset.winner ?? '-'}</span>
                </div>
                {missing && <div className="asset-missing">Missing required files</div>}
              </button>
            );
          })}
          {!filtered.length && <div className="empty">No assets found</div>}
        </div>
      </div>

      <div className="panel highlight">
        <div className="panel-header">
          <div>
            <h2>Project Setup</h2>
            <p>Confirm inputs and choose a BGM/character.</p>
          </div>
        </div>

        {selected ? (
          <div className="detail-stack">
            <div className="detail">
              <span className="label">battle_id</span>
              <span>{selected.battle_id}</span>
            </div>
            <div className="detail">
              <span className="label">base_mp4</span>
              <span className="truncate">{selected.base_mp4 || 'missing'}</span>
            </div>
            <div className="detail">
              <span className="label">battle_log</span>
              <span className="truncate">{selected.battle_log || 'missing'}</span>
            </div>
            <div className="detail">
              <span className="label">ts_log</span>
              <span className="truncate">{selected.ts_log || 'missing (optional)'}</span>
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
              <span className="label">character</span>
              <select className="input" value={selectedCharacter} onChange={(e) => setSelectedCharacter(e.target.value)}>
                {characters.map((char) => (
                  <option key={char.character_id} value={char.character_id}>
                    {char.name}
                  </option>
                ))}
              </select>
            </div>

            <button className="primary" onClick={onCreate} disabled={!canCreate || loading}>
              Create Project
            </button>
            {error && <div className="error">{error}</div>}
            {!canCreate && <div className="hint">Add missing files under data/replays/{'{battle_id}'}</div>}
          </div>
        ) : (
          <div className="empty">Select an asset to continue</div>
        )}

        <div className="panel soft">
          <div className="panel-header">
            <h3>Doctor</h3>
            <button className="ghost" onClick={loadDoctor}>
              Recheck
            </button>
          </div>
          <div className="doctor-list">
            {doctor.map((item) => (
              <div key={item.name} className={`doctor-item ${item.ok ? 'ok' : 'warn'}`}>
                <span>{item.name}</span>
                <span>{item.message}</span>
              </div>
            ))}
            {!doctor.length && <div className="empty">Doctor unavailable</div>}
          </div>
        </div>
      </div>
    </section>
  );
}

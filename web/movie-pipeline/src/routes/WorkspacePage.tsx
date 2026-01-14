import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import SplitPane from '../components/SplitPane.tsx';
import NaturalLoopPlayer from '../components/NaturalLoopPlayer.tsx';
import type { AssetEntry, BgmEntry, CharacterProfile, ProjectRecord } from '../api.ts';
import { API_BASE, assetMediaUrl, bgmMediaUrl, createProject, deleteProject, getAssets, getProjects, getProject } from '../api.ts';

function basename(p: string) {
  const norm = String(p || '').replace(/\\/g, '/');
  const parts = norm.split('/');
  return parts[parts.length - 1] || norm;
}

function shortPath(p: string | null | undefined) {
  if (!p) return { label: '(missing)', detail: '', full: '' };
  const full = String(p);
  const label = basename(full);
  // best-effort relative-ish hint
  const norm = full.replace(/\\/g, '/');
  const idxProjects = norm.indexOf('/projects/');
  const idxData = norm.indexOf('/data/');
  const rel = idxProjects >= 0 ? norm.slice(idxProjects + 1) : idxData >= 0 ? norm.slice(idxData + 1) : '';
  // UI should not expose absolute paths; copy a relative-ish value when possible.
  const safeFull = rel || label;
  // replay-studio style: show the relative-ish path as the main label.
  return { label: rel || label, detail: rel ? label : '', full: safeFull };
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="ghost"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 800);
        } catch {
          // ignore
        }
      }}
      disabled={!text}
      title={text}
      type="button"
    >
      {copied ? 'copied' : 'copy'}
    </button>
  );
}

function Modal({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: any }) {
  if (!open) return null;
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal">
        <div className="modal-header">
          <div className="modal-title">{title}</div>
          <button className="ghost" onClick={onClose} type="button">
            close
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

function AssetPane({
  assets,
  selectedBattleId,
  onSelectBattleId,
  onRefresh,
}: {
  assets: AssetEntry[];
  selectedBattleId: string;
  onSelectBattleId: (id: string) => void;
  onRefresh: () => void;
}) {
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return assets;
    return assets.filter((a) => a.battle_id.toLowerCase().includes(q));
  }, [assets, query]);

  return (
    <div className="panel" style={{ height: '100%', display: 'flex', flexDirection: 'column', minWidth: 0 }}>
      <div className="panel-header">
        <div>
          <h2>Asset</h2>
          <p>battle_id を選択します。</p>
        </div>
        <button className="ghost" onClick={onRefresh} type="button">
          再読み込み
        </button>
      </div>

      <div
        className="detail-stack"
        style={{
          minWidth: 0,
          flex: 1,
          minHeight: 0,
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
        }}
      >
        <div className="detail">
          <span className="label">search</span>
          <input
            className="input"
            placeholder="battle_id"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && filtered.length) {
                onSelectBattleId(filtered[0].battle_id);
              }
            }}
          />
        </div>

        <div className="asset-list" style={{ flex: 1, minHeight: 0, maxHeight: 'none', overflow: 'auto' }}>
          {filtered.slice(0, 200).map((asset) => (
            <button
              key={asset.battle_id}
              className={`asset-card ${selectedBattleId === asset.battle_id ? 'active' : ''}`}
              onClick={() => onSelectBattleId(asset.battle_id)}
              type="button"
            >
              <div className="asset-title truncate">{asset.battle_id}</div>
              <div className="asset-meta">
                <span className={asset.base_mp4 ? 'ok' : 'warn'}>base</span>
                <span className={asset.ts_log ? 'ok' : 'warn'}>battlelog</span>
              </div>
            </button>
          ))}
          {!filtered.length && <div className="empty">No assets</div>}
        </div>

        <div className="hint">{query.trim() ? `表示: ${filtered.length} 件` : `全件: ${assets.length} 件`}</div>
      </div>
    </div>
  );
}

export default function WorkspacePage() {
  const params = useParams();
  const navigate = useNavigate();
  const initialProjectId = (params as any)?.id as string | undefined;

  const [assets, setAssets] = useState<AssetEntry[]>([]);
  const [bgm, setBgm] = useState<BgmEntry[]>([]);
  const [characters, setCharacters] = useState<CharacterProfile[]>([]);
  const [selectedBattleId, setSelectedBattleId] = useState('');

  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [projectId, setProjectId] = useState<string>('');
  const [project, setProject] = useState<ProjectRecord | null>(null);

  const [newProjectId, setNewProjectId] = useState<string>('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [modal, setModal] = useState<{ kind: 'base' | 'battle'; open: boolean }>({ kind: 'base', open: false });
  const [logText, setLogText] = useState<{ battle: string; err: string | null }>({ battle: '', err: null });
  const selectedAsset = useMemo(() => assets.find((a) => a.battle_id === selectedBattleId) || null, [assets, selectedBattleId]);

  const refreshAll = async (refreshAssets?: boolean) => {
    setLoading(true);
    setError(null);
    try {
      const [a, p] = await Promise.all([getAssets(Boolean(refreshAssets)), getProjects()]);
      setAssets(a.registry.assets);
      setBgm(a.bgm);
      setCharacters(a.characters);
      setProjects(p.projects);

      if (!selectedBattleId && a.registry.assets.length) setSelectedBattleId(a.registry.assets[0].battle_id);
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refreshAll();
  }, []);

  useEffect(() => {
    const pid = (initialProjectId || '').trim();
    if (pid) setProjectId(pid);
  }, [initialProjectId]);

  useEffect(() => {
    const pid = projectId.trim();
    if (!pid) {
      setProject(null);
      return;
    }
    let canceled = false;
    getProject(pid)
      .then((p) => {
        if (canceled) return;
        setProject(p);
      })
      .catch((e) => {
        if (canceled) return;
        setError(String((e as any)?.message ?? e));
        setProject(null);
      });
    return () => {
      canceled = true;
    };
  }, [projectId]);

  useEffect(() => {
    if (!modal.open) return;
    if (!selectedAsset) return;
    let canceled = false;
    setLogText((prev) => ({ ...prev, err: null }));
    const load = async () => {
      try {
        if (modal.kind === 'battle' && selectedAsset.battle_id) {
          const txt = await fetch(assetMediaUrl(selectedAsset.battle_id, 'ts_log')).then((r) => (r.ok ? r.text() : ''));
          if (canceled) return;
          setLogText((prev) => ({ ...prev, battle: txt || '' }));
        }
      } catch (e: any) {
        if (canceled) return;
        setLogText((prev) => ({ ...prev, err: String(e?.message ?? e) }));
      }
    };
    void load();
    return () => {
      canceled = true;
    };
  }, [modal.open, modal.kind, selectedAsset?.battle_id]);

  // Create-project validity (raw log no longer required)
  const inputStatus = useMemo(() => {
    const baseOk = Boolean(selectedAsset?.base_mp4);
    const battleOk = Boolean(selectedAsset?.ts_log);
    return { baseOk, battleOk };
  }, [selectedAsset?.battle_id, selectedAsset?.base_mp4, selectedAsset?.ts_log]);

  const [selectedBgm, setSelectedBgm] = useState<string>('');
  const [selectedCharacter, setSelectedCharacter] = useState<string>('');
  const selectedBgmEntry = useMemo(() => bgm.find((b) => b.path === selectedBgm) || null, [bgm, selectedBgm]);
  const visibleCharacters = useMemo(() => characters.filter((c) => c.character_id === 'mao_pro_en'), [characters]);
  const selectedCharacterProfile = useMemo(
    () => visibleCharacters.find((c) => c.character_id === selectedCharacter) || null,
    [visibleCharacters, selectedCharacter]
  );

  const live2dPreviewUrl = useMemo(() => {
    const url = new URL(API_BASE + '/api/mp/live2d/preview');
    if (selectedCharacter) url.searchParams.set('character_id', selectedCharacter);
    return url.toString();
  }, [selectedCharacter]);

  // Default to mao when available.
  useEffect(() => {
    if (selectedCharacter) return;
    if (visibleCharacters.length === 1) setSelectedCharacter(visibleCharacters[0].character_id);
  }, [visibleCharacters.length]);

  const canCreateProject = Boolean(selectedAsset?.battle_id && inputStatus.baseOk && inputStatus.battleOk && selectedBgmEntry?.name && selectedCharacter);

  const basePath = shortPath(selectedAsset?.base_mp4 ?? null);
  const tsPath = shortPath(selectedAsset?.ts_log ?? null);

  return (
    <SplitPane
      storageKey="mp.workspace.split.leftPx"
      leftMinPx={280}
      rightMinPx={520}
      defaultLeftPx={520}
      left={
        <AssetPane
          assets={assets}
          selectedBattleId={selectedBattleId}
          onSelectBattleId={(id) => setSelectedBattleId(id)}
          onRefresh={() => void refreshAll(true)}
        />
      }
      right={
        <div className="panel" style={{ height: '100%', minWidth: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <div className="panel-header">
            <div>
              <h2>Project</h2>
              <p>入力を揃えて、Project を作成します（Stages は Project ページ）。</p>
            </div>
            <div className="panel-actions">
              <button className="ghost" onClick={() => void refreshAll(true)} disabled={loading} type="button">
                refresh
              </button>
            </div>
          </div>

          <div className="panel-body" style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
            {error && <div className="error">{error}</div>}

            {/* Project selector / creation */}
            <div className="detail-stack" style={{ minWidth: 0 }}>
            <div className="detail-grid">
              <div className="detail">
                <span className="label">project</span>
                <select
                  className="input"
                  value={projectId}
                  onChange={(e) => {
                    const next = String(e.target.value || '').trim();
                    setProjectId(next);
                  }}
                >
                  <option value="">(none)</option>
                  {projects.map((p) => (
                    <option key={p.project_id} value={p.project_id}>
                      {p.project_id}
                    </option>
                  ))}
                </select>
                <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
                  <button
                    className="ghost"
                    disabled={!projectId || loading}
                    onClick={() => {
                      if (!projectId) return;
                      navigate(`/projects/${encodeURIComponent(projectId)}`);
                    }}
                    type="button"
                  >
                    Open
                  </button>
                  <button
                    className="ghost"
                    disabled={!projectId || loading}
                    onClick={async () => {
                      if (!projectId) return;
                      if (!confirm(`Delete project?\n\n${projectId}`)) return;
                      setLoading(true);
                      setError(null);
                      try {
                        await deleteProject(projectId);
                        setProjectId('');
                        setProject(null);
                        navigate('/');
                        const p = await getProjects();
                        setProjects(p.projects);
                      } catch (e: any) {
                        setError(String(e?.message ?? e));
                      } finally {
                        setLoading(false);
                      }
                    }}
                    type="button"
                  >
                    Delete
                  </button>
                </div>
              </div>

              <div className="detail">
                <span className="label">battle_id</span>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{ fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis' }}>{selectedAsset?.battle_id || '(select asset)'}</span>
                  <span className="hint">{loading ? 'loading…' : ''}</span>
                </div>
              </div>
            </div>

            {/* Input zone (spec: inputs only) */}
            <div className="panel soft" style={{ marginTop: 0 }}>
              <div className="panel-header">
                <div>
                  <h3>Inputs</h3>
                  <p>生成物はここに表示しません。</p>
                </div>
                <div className="panel-actions">
                  <label className="detail" style={{ margin: 0 }}>
                    <span className="label">project name（optional）</span>
                    <input
                      className="input"
                      value={newProjectId}
                      onChange={(e) => setNewProjectId(e.target.value)}
                      placeholder="例: my_project_01"
                      disabled={loading}
                    />
                  </label>
                </div>
                <button
                  className="primary"
                  disabled={!canCreateProject}
                  title={!canCreateProject ? 'inputs missing/invalid' : ''}
                  onClick={async () => {
                    if (!selectedAsset) return;
                    setLoading(true);
                    setError(null);
                    try {
                      const created = await createProject({
                        project_id: newProjectId.trim() || undefined,
                        battle_id: selectedAsset.battle_id,
                        bgm_name: selectedBgmEntry?.name || null,
                        character_id: selectedCharacter,
                      });
                      setNewProjectId('');
                      setProjectId(created.project_id);
                      setProject(created);
                      navigate(`/projects/${encodeURIComponent(created.project_id)}`);
                      // refresh project list
                      const p = await getProjects();
                      setProjects(p.projects);
                    } catch (e: any) {
                      setError(String(e?.message ?? e));
                    } finally {
                      setLoading(false);
                    }
                  }}
                  type="button"
                >
                  Create
                </button>
              </div>

              <div className="input-zone">
                <div className="input-row">
                  <div className="input-head">
                    <div className="input-name">Base MP4</div>
                    <div className={`badge ${inputStatus.baseOk ? 'ok' : 'missing'}`}>{inputStatus.baseOk ? 'OK' : 'MISSING'}</div>
                  </div>
                  <div className="input-body">
                    <div className="path-row">
                      <div className="path-main">{basePath.label}</div>
                      <div className="path-actions">
                        <button className="ghost" onClick={() => setModal({ kind: 'base', open: true })} disabled={!inputStatus.baseOk} type="button">
                          expand
                        </button>
                        <CopyButton text={basePath.full} />
                      </div>
                    </div>
                    {basePath.detail && <div className="hint">{basePath.detail}</div>}
                    {inputStatus.baseOk ? (
                      <video className="preview-video" controls preload="metadata" src={assetMediaUrl(selectedAsset!.battle_id, 'base_mp4')} />
                    ) : (
                      <div className="empty">base mp4 missing</div>
                    )}
                  </div>
                </div>

                <div className="input-row">
                  <div className="input-head">
                    <div className="input-name">Battle Log</div>
                    <div className={`badge ${inputStatus.battleOk ? 'ok' : 'missing'}`}>{inputStatus.battleOk ? 'OK' : 'MISSING'}</div>
                  </div>
                  <div className="input-body">
                    <div className="path-row">
                      <div className="path-main">{tsPath.label}</div>
                      <div className="path-actions">
                        <button className="ghost" onClick={() => setModal({ kind: 'battle', open: true })} disabled={!inputStatus.battleOk} type="button">
                          expand
                        </button>
                        <CopyButton text={tsPath.full} />
                      </div>
                    </div>
                    {tsPath.detail && <div className="hint">{tsPath.detail}</div>}
                    {!inputStatus.battleOk && <div className="hint">Base MP4 と同一フォルダ（または規定パス）に battle log（*.battlelog.jsonl）が見つかりません。</div>}
                    {inputStatus.battleOk ? (
                      <pre className="code-block preview-text">{(logText.battle || '').slice(0, 1200) || '(open modal to view)'}</pre>
                    ) : (
                      <div className="empty">battle log missing</div>
                    )}
                  </div>
                </div>

                <div className="input-row">
                  <div className="input-head">
                    <div className="input-name">BGM MP3</div>
                    <div className={`badge ${selectedBgm ? 'ok' : 'missing'}`}>{selectedBgm ? 'OK' : 'MISSING'}</div>
                  </div>
                  <div className="input-body">
                    <select className="input" value={selectedBgm} onChange={(e) => setSelectedBgm(e.target.value)}>
                      <option value="">(select)</option>
                      {bgm.map((b) => (
                        <option key={b.path} value={b.path}>
                          {b.name}
                        </option>
                      ))}
                    </select>
                    {selectedBgmEntry ? (
                      <div style={{ marginTop: 8 }}>
                        <div className="hint">{basename(selectedBgmEntry.path)}</div>
                        <NaturalLoopPlayer src={bgmMediaUrl(selectedBgmEntry.name)} loop={selectedBgmEntry.loop ?? null} />
                      </div>
                    ) : (
                      <div className="empty">bgm required</div>
                    )}
                  </div>
                </div>

                <div className="input-row">
                  <div className="input-head">
                    <div className="input-name">Character ID</div>
                    <div className={`badge ${selectedCharacter ? 'ok' : 'missing'}`}>{selectedCharacter ? 'OK' : 'MISSING'}</div>
                  </div>
                  <div className="input-body">
                    <select className="input" value={selectedCharacter} onChange={(e) => setSelectedCharacter(e.target.value)}>
                      <option value="">(select)</option>
                      {visibleCharacters.map((c) => (
                        <option key={c.character_id} value={c.character_id}>
                          {c.character_id}
                        </option>
                      ))}
                    </select>
                    <div className="hint" style={{ marginTop: 8 }}>
                      {selectedCharacterProfile ? `${selectedCharacterProfile.character_id} / ${selectedCharacterProfile.name}` : '選択してください'}
                    </div>
                    <a className="link" href={live2dPreviewUrl} target="_blank" rel="noreferrer" style={{ display: 'inline-block', marginTop: 8 }}>
                      Live2D プレビューを開く
                    </a>
                  </div>
                </div>
              </div>
            </div>
            </div>
          </div>

          <Modal
            open={modal.open && modal.kind === 'base'}
            title="Base MP4"
            onClose={() => setModal((m) => ({ ...m, open: false }))}
          >
            {selectedAsset?.base_mp4 ? <video controls src={assetMediaUrl(selectedAsset.battle_id, 'base_mp4')} style={{ width: '100%' }} /> : <div className="empty">missing</div>}
          </Modal>

          <Modal
            open={modal.open && modal.kind === 'battle'}
            title="Battle Log"
            onClose={() => setModal((m) => ({ ...m, open: false }))}
          >
            {inputStatus.battleOk ? <pre className="code-block modal-pre">{logText.battle || '(empty)'}</pre> : <div className="empty">missing</div>}
            {logText.err && <div className="error">{logText.err}</div>}
          </Modal>
        </div>
      }
    />
  );
}

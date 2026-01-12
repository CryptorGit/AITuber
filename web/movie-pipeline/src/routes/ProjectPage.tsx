import { useEffect, useMemo, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import type { ProjectRecord, StepName, ProjectSettings, BgmEntry, CharacterProfile, GoogleVoice } from '../api.ts';
import { getProject, runProjectStep, getStepLog, projectFileUrl, updateProject, updateScript, getAssets, getVoices } from '../api.ts';

const STEP_ORDER: { key: StepName; title: string; desc: string }[] = [
  { key: 'ladm', title: 'LADM Script + Subtitle', desc: 'Generate script/subtitle draft.' },
  { key: 'tts', title: 'TTS Audio', desc: 'Generate tts audio and normalized subtitles.' },
  { key: 'live2d', title: 'Renderer Overlay', desc: 'Render overlay video and lip sync.' },
  { key: 'compose', title: 'Final Compose', desc: 'Overlay + mix audio + optional subtitles.' },
];

export default function ProjectPage() {
  const params = useParams();
  const projectId = params.id || '';
  const [project, setProject] = useState<ProjectRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<Record<string, string>>({});
  const [loadingStep, setLoadingStep] = useState<string | null>(null);
  const [scriptDraft, setScriptDraft] = useState<any | null>(null);
  const [subtitleText, setSubtitleText] = useState<string>('');
  const [settingsDraft, setSettingsDraft] = useState<ProjectSettings | null>(null);
  const [bgmList, setBgmList] = useState<BgmEntry[]>([]);
  const [characters, setCharacters] = useState<CharacterProfile[]>([]);
  const [voices, setVoices] = useState<GoogleVoice[]>([]);
  const [voicesLoading, setVoicesLoading] = useState(false);
  const [voicesError, setVoicesError] = useState<string | null>(null);

  const refresh = async () => {
    if (!projectId) return;
    try {
      const data = await getProject(projectId);
      setProject(data);
      if (!settingsDraft) setSettingsDraft(data.settings);
    } catch (e: any) {
      setError(String(e?.message ?? e));
    }
  };

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 3000);
    return () => clearInterval(t);
  }, [projectId]);

  useEffect(() => {
    if (project) setSettingsDraft(project.settings);
  }, [project?.updated_at]);

  useEffect(() => {
    getAssets()
      .then((data) => {
        setBgmList(data.bgm);
        setCharacters(data.characters);
      })
      .catch(() => undefined);
  }, []);

  const loadVoices = async (languageCode?: string) => {
    const lang = (languageCode ?? '').trim();
    setVoicesLoading(true);
    setVoicesError(null);
    try {
      const data = await getVoices(lang || undefined);
      setVoices(data.voices || []);
    } catch (e: any) {
      setVoicesError(String(e?.message ?? e));
      setVoices([]);
    } finally {
      setVoicesLoading(false);
    }
  };

  useEffect(() => {
    if (!settingsDraft || settingsDraft.tts.provider !== 'google') {
      setVoices([]);
      setVoicesError(null);
      setVoicesLoading(false);
      return;
    }
    void loadVoices(settingsDraft.tts.google.language_code);
  }, [settingsDraft?.tts.provider, settingsDraft?.tts.google.language_code]);

  useEffect(() => {
    if (!project?.outputs.script_json) return;
    const url = projectFileUrl(project.project_id, project.outputs.script_json);
    fetch(url)
      .then((r) => r.json())
      .then((json) => setScriptDraft(json))
      .catch(() => setScriptDraft(null));
  }, [project?.outputs.script_json, project?.project_id]);

  useEffect(() => {
    if (!project?.outputs.subtitles_srt) return;
    const url = projectFileUrl(project.project_id, project.outputs.subtitles_srt);
    fetch(url)
      .then((r) => r.text())
      .then((text) => setSubtitleText(text))
      .catch(() => setSubtitleText(''));
  }, [project?.outputs.subtitles_srt, project?.project_id]);

  const runStep = async (step: StepName | 'all', force?: boolean) => {
    if (!projectId) return;
    setLoadingStep(step + (force ? '_force' : ''));
    setError(null);
    try {
      const updated = await runProjectStep(projectId, step, force);
      setProject(updated);
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setLoadingStep(null);
    }
  };

  const loadLog = async (step: StepName) => {
    try {
      const text = await getStepLog(projectId, step, project?.last_run_id || undefined);
      setLogs((prev) => ({ ...prev, [step]: text }));
    } catch (e: any) {
      setLogs((prev) => ({ ...prev, [step]: String(e?.message ?? e) }));
    }
  };

  const artifactUrl = (rel: string | null) => {
    if (!project || !rel) return '';
    return projectFileUrl(project.project_id, rel);
  };

  const inputRows = useMemo(() => {
    if (!project) return [];
    return [
      { label: 'base_mp4', value: project.inputs.base_mp4 },
      { label: 'battle_log', value: project.inputs.battle_log },
      { label: 'ts_log', value: project.inputs.ts_log || '(none)' },
      { label: 'bgm_mp3', value: project.inputs.bgm_mp3 || '(none)' },
      { label: 'character_id', value: project.inputs.character_id || 'builtin_simple' },
    ];
  }, [project]);

  const onSaveSettings = async () => {
    if (!settingsDraft || !project) return;
    try {
      const updated = await updateProject(project.project_id, {
        settings: settingsDraft,
        bgm_path: project.inputs.bgm_mp3,
        character_id: project.inputs.character_id,
      });
      setProject(updated);
    } catch (e: any) {
      setError(String(e?.message ?? e));
    }
  };

  const onScriptTextChange = (idx: number, value: string) => {
    if (!scriptDraft) return;
    const segments = scriptDraft.segments.slice();
    segments[idx] = { ...segments[idx], text: value };
    setScriptDraft({ ...scriptDraft, segments });
  };

  const onSaveScript = async () => {
    if (!scriptDraft || !project) return;
    try {
      const updated = await updateScript(project.project_id, scriptDraft);
      setProject(updated);
    } catch (e: any) {
      setError(String(e?.message ?? e));
    }
  };

  if (!project && error) {
    return (
      <div className="panel">
        <div className="panel-header">
          <h2>Project</h2>
        </div>
        <div className="error">{error}</div>
        <Link to="/" className="ghost">Back to Assets</Link>
      </div>
    );
  }

  const voiceListId = `voice-list-${projectId || 'default'}`;
  const selectedVoice = voices.find((voice) => voice.name === settingsDraft?.tts.google.voice_name);

  return (
    <div className="project-stack">
      <div className="panel project-hero">
        <div>
          <div className="eyebrow">Project</div>
          <h2>{project?.project_id}</h2>
          <p>Battle: {project?.battle_id}</p>
        </div>
        <div className="hero-actions">
          <button className="primary" onClick={() => runStep('all')} disabled={loadingStep !== null}>
            Run All
          </button>
          <button className="ghost" onClick={() => runStep('all', true)} disabled={loadingStep !== null}>
            Force Run
          </button>
        </div>
      </div>

      <div className="panel">
        <div className="panel-header">
          <h3>Inputs</h3>
        </div>
        <div className="detail-grid">
          {inputRows.map((row) => (
            <div key={row.label} className="detail">
              <span className="label">{row.label}</span>
              <span className="truncate">{row.value}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="panel">
        <div className="panel-header">
          <h3>Settings</h3>
          <button className="ghost" onClick={onSaveSettings}>
            Save Settings
          </button>
        </div>
        {settingsDraft && project && (
          <div className="settings-grid">
            <label className="detail">
              <span className="label">BGM</span>
              <select
                className="input"
                value={project.inputs.bgm_mp3 || ''}
                onChange={(e) =>
                  setProject({
                    ...project,
                    inputs: { ...project.inputs, bgm_mp3: e.target.value || null },
                  })
                }
              >
                <option value="">(none)</option>
                {bgmList.map((track) => (
                  <option key={track.path} value={track.path}>
                    {track.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="detail">
              <span className="label">Character</span>
              <select
                className="input"
                value={project.inputs.character_id || 'builtin_simple'}
                onChange={(e) =>
                  setProject({
                    ...project,
                    inputs: { ...project.inputs, character_id: e.target.value || null },
                  })
                }
              >
                {characters.map((char) => (
                  <option key={char.character_id} value={char.character_id}>
                    {char.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="detail">
              <span className="label">TTS Provider</span>
              <select
                className="input"
                value={settingsDraft.tts.provider}
                onChange={(e) =>
                  setSettingsDraft({
                    ...settingsDraft,
                    tts: { ...settingsDraft.tts, provider: e.target.value as 'google' | 'voicevox' },
                  })
                }
              >
                <option value="google">Google TTS</option>
                <option value="voicevox">VOICEVOX</option>
              </select>
            </label>

            {settingsDraft.tts.provider === 'google' ? (
              <>
                <label className="detail">
                  <span className="label">Language Code</span>
                  <input
                    className="input"
                    value={settingsDraft.tts.google.language_code}
                    onChange={(e) =>
                      setSettingsDraft({
                        ...settingsDraft,
                        tts: {
                          ...settingsDraft.tts,
                          google: { ...settingsDraft.tts.google, language_code: e.target.value },
                        },
                      })
                    }
                  />
                </label>
                <label className="detail">
                  <span className="label">Voice Name</span>
                  <input
                    className="input"
                    list={voiceListId}
                    value={settingsDraft.tts.google.voice_name}
                    onChange={(e) =>
                      setSettingsDraft({
                        ...settingsDraft,
                        tts: { ...settingsDraft.tts, google: { ...settingsDraft.tts.google, voice_name: e.target.value } },
                      })
                    }
                  />
                  <datalist id={voiceListId}>
                    {voices.map((voice) => (
                      <option key={voice.name} value={voice.name} />
                    ))}
                  </datalist>
                  {selectedVoice?.naturalSampleRateHertz ? (
                    <div className="hint">natural sample rate: {selectedVoice.naturalSampleRateHertz} Hz</div>
                  ) : null}
                  <div className="hint">
                    {voicesLoading ? 'loading voices...' : voicesError ? `voices error: ${voicesError}` : `${voices.length} voices`}
                  </div>
                  <button className="ghost" type="button" onClick={() => loadVoices(settingsDraft.tts.google.language_code)} disabled={voicesLoading}>
                    Refresh Voices
                  </button>
                </label>
                <label className="detail">
                  <span className="label">Speaking Rate</span>
                  <input
                    className="input"
                    type="number"
                    step="0.05"
                    value={settingsDraft.tts.google.speaking_rate}
                    onChange={(e) =>
                      setSettingsDraft({
                        ...settingsDraft,
                        tts: {
                          ...settingsDraft.tts,
                          google: { ...settingsDraft.tts.google, speaking_rate: Number(e.target.value) },
                        },
                      })
                    }
                  />
                </label>
                <label className="detail">
                  <span className="label">Pitch</span>
                  <input
                    className="input"
                    type="number"
                    step="0.1"
                    value={settingsDraft.tts.google.pitch}
                    onChange={(e) =>
                      setSettingsDraft({
                        ...settingsDraft,
                        tts: { ...settingsDraft.tts, google: { ...settingsDraft.tts.google, pitch: Number(e.target.value) } },
                      })
                    }
                  />
                </label>
                <label className="detail">
                  <span className="label">Audio Encoding</span>
                  <select
                    className="input"
                    value={settingsDraft.tts.google.audio_encoding}
                    onChange={(e) =>
                      setSettingsDraft({
                        ...settingsDraft,
                        tts: {
                          ...settingsDraft.tts,
                          google: { ...settingsDraft.tts.google, audio_encoding: e.target.value as 'LINEAR16' | 'MP3' },
                        },
                      })
                    }
                  >
                    <option value="LINEAR16">LINEAR16 (WAV)</option>
                    <option value="MP3">MP3</option>
                      </select>
                </label>
                <label className="detail">
                  <span className="label">Volume Gain (dB)</span>
                  <input
                    className="input"
                    type="number"
                    step="0.5"
                    value={settingsDraft.tts.google.volume_gain_db}
                    onChange={(e) =>
                      setSettingsDraft({
                        ...settingsDraft,
                        tts: { ...settingsDraft.tts, google: { ...settingsDraft.tts.google, volume_gain_db: Number(e.target.value) } },
                      })
                    }
                  />
                </label>
                <label className="detail">
                  <span className="label">Sample Rate (Hz)</span>
                  <input
                    className="input"
                    type="number"
                    step="1000"
                    value={settingsDraft.tts.google.sample_rate_hertz}
                    onChange={(e) =>
                      setSettingsDraft({
                        ...settingsDraft,
                        tts: { ...settingsDraft.tts, google: { ...settingsDraft.tts.google, sample_rate_hertz: Number(e.target.value) } },
                      })
                    }
                  />
                </label>
              </>
            ) : (
              <>
                <label className="detail">
                  <span className="label">Voicevox Base URL</span>
                  <input
                    className="input"
                    value={settingsDraft.tts.voicevox.base_url}
                    onChange={(e) =>
                      setSettingsDraft({
                        ...settingsDraft,
                        tts: {
                          ...settingsDraft.tts,
                          voicevox: { ...settingsDraft.tts.voicevox, base_url: e.target.value },
                        },
                      })
                    }
                  />
                </label>
                <label className="detail">
                  <span className="label">Voicevox Speaker</span>
                  <input
                    className="input"
                    type="number"
                    value={settingsDraft.tts.voicevox.speaker}
                    onChange={(e) =>
                      setSettingsDraft({
                        ...settingsDraft,
                        tts: {
                          ...settingsDraft.tts,
                          voicevox: { ...settingsDraft.tts.voicevox, speaker: Number(e.target.value) },
                        },
                      })
                    }
                  />
                </label>
                <label className="detail">
                  <span className="label">Speed</span>
                  <input
                    className="input"
                    type="number"
                    step="0.05"
                    value={settingsDraft.tts.voicevox.speed_scale}
                    onChange={(e) =>
                      setSettingsDraft({
                        ...settingsDraft,
                        tts: {
                          ...settingsDraft.tts,
                          voicevox: { ...settingsDraft.tts.voicevox, speed_scale: Number(e.target.value) },
                        },
                      })
                    }
                  />
                </label>
              </>
            )}

            <label className="detail">
              <span className="label">Overlay Scale</span>
              <input
                className="input"
                type="number"
                step="0.05"
                value={settingsDraft.render.overlay_scale}
                onChange={(e) =>
                  setSettingsDraft({
                    ...settingsDraft,
                    render: { ...settingsDraft.render, overlay_scale: Number(e.target.value) },
                  })
                }
              />
            </label>

            <label className="detail">
              <span className="label">Burn Subtitles</span>
              <select
                className="input"
                value={settingsDraft.subtitles.burn_in ? 'yes' : 'no'}
                onChange={(e) =>
                  setSettingsDraft({
                    ...settingsDraft,
                    subtitles: { ...settingsDraft.subtitles, burn_in: e.target.value === 'yes' },
                  })
                }
              >
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
            </label>
          </div>
        )}
      </div>

      <div className="panel">
        <div className="panel-header">
          <h3>Script Editor</h3>
          <button className="ghost" onClick={onSaveScript}>
            Save Script
          </button>
        </div>
        {scriptDraft?.segments ? (
          <div className="script-list">
            {scriptDraft.segments.map((seg: any, idx: number) => (
              <div key={seg.id} className="script-item">
                <div className="label">{seg.id}</div>
                <textarea
                  className="input"
                  rows={2}
                  value={seg.text}
                  onChange={(e) => onScriptTextChange(idx, e.target.value)}
                />
                <div className="hint">emotion: {seg.emotion_tag}</div>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty">Run LADM to generate script.json</div>
        )}
      </div>

      {STEP_ORDER.map((step) => {
        const s = project?.steps[step.key];
        const status = s?.status || 'PENDING';
        return (
          <div key={step.key} className="panel">
            <div className="panel-header">
              <div>
                <h3>{step.title}</h3>
                <p>{step.desc}</p>
              </div>
              <div className="panel-actions">
                <span className={`badge ${status.toLowerCase()}`}>{status}</span>
                <button
                  className="ghost"
                  onClick={() => runStep(step.key)}
                  disabled={loadingStep !== null}
                >
                  Run
                </button>
                <button className="ghost" onClick={() => runStep(step.key, true)} disabled={loadingStep !== null}>
                  Force
                </button>
                <button className="ghost" onClick={() => loadLog(step.key)}>
                  Load Log
                </button>
              </div>
            </div>

            {s?.error && <div className="error">{s.error}</div>}

            <div className="step-body">
              {step.key === 'tts' && (
                <div className="preview-grid">
                  <div>
                    <div className="label">tts.wav</div>
                    {project?.outputs.tts_wav ? (
                      <audio controls src={artifactUrl(project.outputs.tts_wav)} />
                    ) : (
                      <div className="empty">No audio yet</div>
                    )}
                  </div>
                  <div>
                    <div className="label">subtitles.srt</div>
                    <pre className="code-block">{subtitleText || 'No subtitles yet'}</pre>
                  </div>
                </div>
              )}

              {step.key === 'live2d' && (
                <div>
                  <div className="label">overlay video</div>
                  {project?.outputs.overlay_webm ? (
                    <video controls src={artifactUrl(project.outputs.overlay_webm)} />
                  ) : (
                    <div className="empty">No overlay yet</div>
                  )}
                </div>
              )}

              {step.key === 'compose' && (
                <div>
                  <div className="label">final.mp4</div>
                  {project?.outputs.final_mp4 ? (
                    <video controls src={artifactUrl(project.outputs.final_mp4)} />
                  ) : (
                    <div className="empty">No final mp4 yet</div>
                  )}
                  {project?.outputs.final_with_subs_mp4 && (
                    <a className="link" href={artifactUrl(project.outputs.final_with_subs_mp4)} target="_blank" rel="noreferrer">
                      View final_with_subs.mp4
                    </a>
                  )}
                </div>
              )}
            </div>

            {logs[step.key] && (
              <div className="log-block">
                <div className="label">Log (tail)</div>
                <pre className="code-block">{logs[step.key]}</pre>
              </div>
            )}
          </div>
        );
      })}

      {error && <div className="error">{error}</div>}
    </div>
  );
}

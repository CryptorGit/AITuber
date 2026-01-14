import { useEffect, useMemo, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import type { ProjectRecord, StepName, ProjectSettings, BgmEntry, CharacterProfile, GoogleVoice } from '../api.ts';
import {
  getProject,
  runProjectStep,
  getStepLog,
  projectFileUrl,
  updateProject,
  updateScript,
  updateSubtitleTimeline,
  updateLive2dMotion,
  llmGenerate,
  getLlmPrompts,
  updateLlmPrompts,
  getLlmConfig,
  getAssets,
  getVoices,
  assetMediaUrl,
  API_BASE,
} from '../api.ts';

function fileNameOnly(value: string | null | undefined): string {
  const raw = String(value ?? '').trim();
  if (!raw) return '(none)';
  const normalized = raw.replace(/\\/g, '/');
  const parts = normalized.split('/').filter(Boolean);
  return parts.length ? parts[parts.length - 1] : raw;
}

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

  const [llmModel, setLlmModel] = useState<string>(() => localStorage.getItem('mp.llm.model') || '');
  const [llmMaxOutputTokens, setLlmMaxOutputTokens] = useState<string>(() => localStorage.getItem('mp.llm.max_output_tokens') || '');
  const [scriptPrompt, setScriptPrompt] = useState<string>('');
  const [subtitlesPrompt, setSubtitlesPrompt] = useState<string>('');
  const [motionPrompt, setMotionPrompt] = useState<string>('');
  const [llmPromptsLoading, setLlmPromptsLoading] = useState<boolean>(false);
  const [llmPromptsSaving, setLlmPromptsSaving] = useState<boolean>(false);
  const [llmBusy, setLlmBusy] = useState<string | null>(null);
  const [llmError, setLlmError] = useState<string | null>(null);
  const [llmPreview, setLlmPreview] = useState<Record<string, any>>({});

  const canRun = useMemo(() => {
    if (!project) {
      return { tts: false, live2d: false, compose: false } as const;
    }

    const hasBase = Boolean(project.inputs.base_mp4);
    const hasScript = Boolean(project.outputs.script_json);

    const hasTtsAudio = Boolean(project.outputs.tts_wav) || Boolean(project.outputs.tts_mp3);
    const hasTtsTiming = Boolean(project.outputs.tts_timing_json);

    const hasOverlay = Boolean(project.outputs.overlay_webm);
    const hasMotion = Boolean(project.outputs.live2d_motion_json);

    // Backend now auto-generates missing narration/subtitle timelines from script where possible.
    const ttsReady = hasScript;
    // Live2D can run before TTS (uses silence placeholder) but requires script.
    const live2dReady = hasScript;
    const composeReady = hasBase && hasOverlay && hasTtsAudio && hasTtsTiming;

    return { tts: ttsReady, live2d: live2dReady, compose: composeReady, _motionOptional: !hasMotion } as const;
  }, [project?.project_id, project?.updated_at]);

  const basePreviewUrl = useMemo(() => {
    if (!project?.battle_id) return '';
    return assetMediaUrl(project.battle_id, 'base_mp4');
  }, [project?.battle_id]);

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

  const loadLlmPrompts = async () => {
    setLlmPromptsLoading(true);
    setLlmError(null);
    try {
      const res = await getLlmPrompts();
      setScriptPrompt(String(res?.script ?? ''));
      setSubtitlesPrompt(String(res?.subtitles ?? ''));
      setMotionPrompt(String(res?.live2d_motion ?? ''));
    } catch (e: any) {
      setLlmError(String(e?.message ?? e));
    } finally {
      setLlmPromptsLoading(false);
    }
  };

  const saveLlmPrompts = async () => {
    setLlmPromptsSaving(true);
    setLlmError(null);
    try {
      await updateLlmPrompts({
        script: scriptPrompt,
        subtitles: subtitlesPrompt,
        live2d_motion: motionPrompt,
      });
    } catch (e: any) {
      setLlmError(String(e?.message ?? e));
    } finally {
      setLlmPromptsSaving(false);
    }
  };

  useEffect(() => {
    void loadLlmPrompts();
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem('mp.llm.model', String(llmModel || ''));
    } catch {
      // ignore
    }
  }, [llmModel]);

  useEffect(() => {
    try {
      const v = String(llmMaxOutputTokens || '').trim();
      if (v) localStorage.setItem('mp.llm.max_output_tokens', v);
      else localStorage.removeItem('mp.llm.max_output_tokens');
    } catch {
      // ignore
    }
  }, [llmMaxOutputTokens]);

  useEffect(() => {
    if (llmModel.trim()) return;
    getLlmConfig()
      .then((cfg) => {
        const m = String(cfg?.default_model || '').trim();
        if (m) setLlmModel(m);
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

  const disabledReason = (step: StepName): string => {
    if (!project) return 'プロジェクト未読込';
    if (step === 'tts') {
      if (!project.outputs.script_json) return 'script_json が必要';
      return '';
    }
    if (step === 'live2d') {
      if (!project.outputs.script_json) return 'script_json が必要';
      return '';
    }
    if (step === 'compose') {
      if (!project.inputs.base_mp4) return 'base_mp4 が必要';
      if (!project.outputs.overlay_webm) return 'overlay_webm が必要';
      if (!project.outputs.tts_wav && !project.outputs.tts_mp3) return 'tts audio が必要';
      if (!project.outputs.tts_timing_json) return 'tts_timing_json が必要';
      return '';
    }
    return '';
  };

  const inputRows = useMemo(() => {
    if (!project) return [];
    return [
      { label: 'base_mp4', value: fileNameOnly(project.inputs.base_mp4) },
      { label: 'battle_log', value: fileNameOnly(project.inputs.battle_log) },
      { label: 'ts_log', value: fileNameOnly(project.inputs.ts_log) },
      { label: 'bgm_mp3', value: fileNameOnly(project.inputs.bgm_mp3) },
      { label: 'character_id', value: project.inputs.character_id || '(auto)' },
    ];
  }, [project]);

  const live2dPreviewUrl = useMemo(() => {
    const id = (project?.inputs.character_id || '').trim();
    const url = new URL(API_BASE + '/api/mp/live2d/preview');
    if (id) url.searchParams.set('character_id', id);
    return url.toString();
  }, [project?.inputs.character_id]);

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
    if (Array.isArray(scriptDraft.lines)) {
      const lines = scriptDraft.lines.slice();
      lines[idx] = { ...lines[idx], text: value };
      setScriptDraft({ ...scriptDraft, lines });
      return;
    }
    if (Array.isArray(scriptDraft.segments)) {
      const segments = scriptDraft.segments.slice();
      segments[idx] = { ...segments[idx], text: value };
      setScriptDraft({ ...scriptDraft, segments });
      return;
    }
  };

  const onSaveScript = async () => {
    if (!scriptDraft || !project) return;
    try {
      const lines = Array.isArray(scriptDraft?.lines)
        ? scriptDraft.lines
        : Array.isArray(scriptDraft?.segments)
          ? scriptDraft.segments.map((s: any, i: number) => ({ id: String(s?.id || `line_${String(i).padStart(3, '0')}`), text: String(s?.text || '') }))
          : [];
      const scriptToSave = { battle_id: project.battle_id, lines };
      const updated = await updateScript(project.project_id, scriptToSave);
      setProject(updated);
    } catch (e: any) {
      setError(String(e?.message ?? e));
    }
  };

  const runLlm = async (kind: 'script' | 'subtitles' | 'live2d_motion') => {
    if (!project) return;
    setLlmBusy(kind);
    setLlmError(null);
    try {
      const prompt = kind === 'script' ? scriptPrompt : kind === 'subtitles' ? subtitlesPrompt : motionPrompt;
      const parsedMax = Number.parseInt(String(llmMaxOutputTokens || '').trim(), 10);
      const max_output_tokens = Number.isFinite(parsedMax) && parsedMax > 0 ? parsedMax : undefined;
      const out = await llmGenerate(project.project_id, {
        kind,
        prompt,
        model: llmModel || undefined,
        ...(max_output_tokens ? { max_output_tokens } : {}),
      });
      setLlmPreview((prev) => ({ ...prev, [kind]: out.json }));
    } catch (e: any) {
      setLlmError(String(e?.message ?? e));
    } finally {
      setLlmBusy(null);
    }
  };

  const applyLlm = async (kind: 'script' | 'subtitles' | 'live2d_motion') => {
    if (!project) return;
    const data = llmPreview[kind];
    if (!data) return;
    setLlmBusy('apply_' + kind);
    setLlmError(null);
    try {
      let updated: ProjectRecord;
      if (kind === 'script') {
        updated = await updateScript(project.project_id, data);
      } else if (kind === 'subtitles') {
        updated = await updateSubtitleTimeline(project.project_id, data);
      } else {
        updated = await updateLive2dMotion(project.project_id, data);
      }
      setProject(updated);
    } catch (e: any) {
      setLlmError(String(e?.message ?? e));
    } finally {
      setLlmBusy(null);
    }
  };

  if (!project && error) {
    return (
      <div className="panel">
        <div className="panel-header">
          <h2>プロジェクト</h2>
        </div>
        <div className="error">{error}</div>
        <Link to="/" className="ghost">アセットへ戻る</Link>
      </div>
    );
  }

  const voiceListId = `voice-list-${projectId || 'default'}`;
  const selectedVoice = voices.find((voice) => voice.name === settingsDraft?.tts.google.voice_name);

  const canRunMotionLlm = Boolean(
    project &&
      (llmPreview.script || project.outputs.script_json) &&
      (llmPreview.subtitles || project.outputs.subtitle_timeline_json)
  );

  const scriptItems: Array<{ id: string; text: string; emotion_tag?: string }> = useMemo(() => {
    if (!scriptDraft) return [];
    if (Array.isArray(scriptDraft.lines)) {
      return scriptDraft.lines.map((l: any, idx: number) => ({ id: String(l?.id || `line_${String(idx).padStart(3, '0')}`), text: String(l?.text || '') }));
    }
    if (Array.isArray(scriptDraft.segments)) {
      return scriptDraft.segments.map((s: any, idx: number) => ({ id: String(s?.id || `seg_${String(idx).padStart(3, '0')}`), text: String(s?.text || ''), emotion_tag: s?.emotion_tag }));
    }
    return [];
  }, [scriptDraft]);

  const runAll = async (force?: boolean) => {
    await runStep('tts', force);
    await runStep('live2d', force);
    await runStep('compose', force);
  };

  return (
    <div className="project-stack">
      <div className="panel project-hero">
        <div>
          <div className="eyebrow">プロジェクト</div>
          <h2>{project?.project_id}</h2>
          <p>battle_id: {project?.battle_id}</p>
        </div>
        <div className="hero-actions">
          <button className="primary" onClick={() => void runAll(false)} disabled={loadingStep !== null || !canRun.tts} title={!canRun.tts ? disabledReason('tts') : undefined}>
            全実行
          </button>
          <button className="ghost" onClick={() => void runAll(true)} disabled={loadingStep !== null || !canRun.tts} title={!canRun.tts ? disabledReason('tts') : undefined}>
            強制全実行
          </button>
        </div>
      </div>

      <div className="panel">
        <div className="panel-header">
          <h3>台本・字幕</h3>
        </div>

        <div className="detail-grid">
          {inputRows.map((row) => (
            <div key={row.label} className="detail">
              <span className="label">{row.label}</span>
              <span className="truncate">{row.value}</span>
            </div>
          ))}

          <div className="detail" style={{ gridColumn: '1 / -1' }}>
            <div className="label">base.mp4 preview</div>
            {basePreviewUrl ? (
              <video controls src={basePreviewUrl} style={{ width: 480, maxWidth: '100%', height: 'auto' }} />
            ) : (
              <div className="empty">base_mp4 がありません</div>
            )}
          </div>

          <div className="detail" style={{ gridColumn: '1 / -1' }}>
            <a className="link" href={live2dPreviewUrl} target="_blank" rel="noreferrer">
              Live2D プレビューを開く
            </a>
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-header">
          <h3>台本・字幕（LLM）</h3>
        </div>
        <div className="settings-grid">
          <label className="detail">
            <span className="label">Gemini モデル</span>
            <input className="input" value={llmModel} onChange={(e) => setLlmModel(e.target.value)} placeholder="gemini-2.0-flash" />
          </label>

          <label className="detail">
            <span className="label">max_output_tokens</span>
            <input
              className="input"
              type="number"
              inputMode="numeric"
              min={512}
              max={32768}
              step={256}
              value={llmMaxOutputTokens}
              onChange={(e) => setLlmMaxOutputTokens(e.target.value)}
              placeholder="16384"
            />
            <div className="hint">空ならデフォルト（16384）。範囲: 512〜32768</div>
          </label>

          <div className="detail" style={{ gridColumn: '1 / -1' }}>
            <span className="label">LLM prompts（ファイル永続）</span>
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button className="ghost" onClick={loadLlmPrompts} disabled={llmPromptsLoading || llmPromptsSaving}>
                読み込み
              </button>
              <button className="ghost" onClick={saveLlmPrompts} disabled={llmPromptsLoading || llmPromptsSaving}>
                保存
              </button>
              {(llmPromptsLoading || llmPromptsSaving) && <span className="hint">処理中…</span>}
            </div>
            <div className="hint">
              保存先: config/movie-pipeline/llm_prompt_script.txt / llm_prompt_subtitles.txt / llm_prompt_live2d_motion.txt
            </div>
          </div>
        </div>

        {llmError && <div className="error">{llmError}</div>}

        <div className="preview-grid">
          <div>
            <div className="label">台本用 LLM（script.json）</div>
            <textarea className="input" rows={5} value={scriptPrompt} onChange={(e) => setScriptPrompt(e.target.value)} placeholder="例: タイムスタンプログを元に、短い実況の台本を JSON で出力してください。" />
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button className="ghost" onClick={() => runLlm('script')} disabled={llmBusy !== null || !scriptPrompt.trim()}>生成</button>
              <button className="ghost" onClick={() => applyLlm('script')} disabled={llmBusy !== null || !llmPreview.script}>適用</button>
            </div>
            <pre className="code-block">{llmPreview.script ? JSON.stringify(llmPreview.script, null, 2) : '未生成'}</pre>
          </div>

          <div>
            <div className="label">字幕用 LLM（subtitle_timeline.json）</div>
            <textarea className="input" rows={5} value={subtitlesPrompt} onChange={(e) => setSubtitlesPrompt(e.target.value)} placeholder="例: 台本とタイムラインに合わせて subtitle timeline (seconds) を JSON で出してください。" />
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button className="ghost" onClick={() => runLlm('subtitles')} disabled={llmBusy !== null || !subtitlesPrompt.trim()}>生成</button>
              <button className="ghost" onClick={() => applyLlm('subtitles')} disabled={llmBusy !== null || !llmPreview.subtitles}>適用</button>
            </div>
            <pre className="code-block">{llmPreview.subtitles ? JSON.stringify(llmPreview.subtitles, null, 2) : '未生成'}</pre>
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-header">
          <h3>台本編集</h3>
          <button className="ghost" onClick={onSaveScript} disabled={loadingStep !== null || scriptItems.length === 0}>
            保存
          </button>
        </div>
        {scriptItems.length ? (
          <div className="script-list">
            {scriptItems.map((seg, idx) => (
              <div key={seg.id} className="script-item">
                <div className="label">{seg.id}</div>
                <textarea className="input" rows={2} value={seg.text} onChange={(e) => onScriptTextChange(idx, e.target.value)} />
                {seg.emotion_tag ? <div className="hint">emotion: {seg.emotion_tag}</div> : null}
              </div>
            ))}
          </div>
        ) : (
          <div className="empty">まず「台本用 LLM」を生成→適用してください（または手動で script.json を保存）</div>
        )}
      </div>

      <div className="panel">
        <div className="panel-header">
          <h3>Live2Dモーション用（LLM）</h3>
        </div>
        {llmError && <div className="error">{llmError}</div>}
        <div className="preview-grid">
          <div>
            <div className="label">Live2D モーション用 LLM（live2d_motion.json）</div>
            <textarea className="input" rows={5} value={motionPrompt} onChange={(e) => setMotionPrompt(e.target.value)} placeholder="例: narration/subtitle timeline を元に、表情/モーションの JSON を生成してください。" />
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button
                className="ghost"
                onClick={() => runLlm('live2d_motion')}
                disabled={llmBusy !== null || !motionPrompt.trim() || !canRunMotionLlm}
                title={!canRunMotionLlm ? '先に台本用/字幕用の生成（または適用）を行ってください' : undefined}
              >
                生成
              </button>
              <button
                className="ghost"
                onClick={() => applyLlm('live2d_motion')}
                disabled={llmBusy !== null || !llmPreview.live2d_motion || !canRunMotionLlm}
                title={!canRunMotionLlm ? '先に台本用/字幕用の生成（または適用）を行ってください' : undefined}
              >
                適用
              </button>
            </div>
            {!canRunMotionLlm && <div className="hint">Live2D モーション生成は、台本用 + 字幕用の生成（または適用）の後に有効になります。</div>}
            <pre className="code-block">{llmPreview.live2d_motion ? JSON.stringify(llmPreview.live2d_motion, null, 2) : '未生成'}</pre>
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-header">
          <div>
            <h3>TTS</h3>
            <p>音声と字幕（SRT/ASS）を生成します。</p>
          </div>
          <div className="panel-actions">
            <button
              className="ghost"
              onClick={() => runStep('tts', project?.steps?.tts?.status === 'SUCCESS')}
              disabled={loadingStep !== null || !canRun.tts}
              title={!canRun.tts ? disabledReason('tts') : undefined}
            >
              実行
            </button>
            <button className="ghost" onClick={() => runStep('tts', true)} disabled={loadingStep !== null || !canRun.tts} title={!canRun.tts ? disabledReason('tts') : undefined}>
              強制
            </button>
            <button className="ghost" onClick={() => loadLog('tts')}>
              ログ取得
            </button>
          </div>
        </div>

        {settingsDraft ? (
          <div className="detail-grid">
            <label className="detail">
              <span className="label">TTS プロバイダ</span>
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
                  <span className="label">言語コード</span>
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
                  <span className="label">音声名（Voice Name）</span>
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
                  {selectedVoice?.naturalSampleRateHertz ? <div className="hint">natural sample rate: {selectedVoice.naturalSampleRateHertz} Hz</div> : null}
                  <div className="hint">{voicesLoading ? 'voices 読み込み中...' : voicesError ? `voices error: ${voicesError}` : `${voices.length} voices`}</div>
                  <button className="ghost" type="button" onClick={() => loadVoices(settingsDraft.tts.google.language_code)} disabled={voicesLoading}>
                    Voices 再読み込み
                  </button>
                </label>
                <label className="detail">
                  <span className="label">読み上げ速度（Speaking Rate）</span>
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
                  <span className="label">ピッチ（Pitch）</span>
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
                  <span className="label">音声形式（Audio Encoding）</span>
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
                  <span className="label">音量ゲイン（dB）</span>
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
                  <span className="label">サンプルレート（Hz）</span>
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
                  <div className="hint">
                    voice naturalSampleRateHertz: {selectedVoice?.naturalSampleRateHertz ? `${selectedVoice.naturalSampleRateHertz}Hz` : '(unknown)'}
                    （この値に固定され、指定値が無視される場合があります）
                  </div>
                </label>
              </>
            ) : (
              <>
                <label className="detail">
                  <span className="label">VOICEVOX Base URL</span>
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
                  <span className="label">VOICEVOX Speaker</span>
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
                  <span className="label">速度（Speed）</span>
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

            <div className="detail" style={{ gridColumn: '1 / -1' }}>
              <button className="ghost" onClick={onSaveSettings}>
                設定保存
              </button>
            </div>
          </div>
        ) : null}

        <div className="step-body">
          <div className="preview-grid">
            <div>
              <div className="label">tts</div>
              {project?.outputs.tts_wav || project?.outputs.tts_mp3 ? (
                <audio controls src={artifactUrl(project.outputs.tts_wav || project.outputs.tts_mp3)} />
              ) : (
                <div className="empty">まだ音声がありません</div>
              )}
            </div>
            <div>
              <div className="label">subtitles.srt</div>
              <pre className="code-block">{subtitleText || 'まだ字幕がありません'}</pre>
            </div>
          </div>
        </div>

        {logs.tts && (
          <div className="log-block">
            <div className="label">ログ（末尾）</div>
            <pre className="code-block">{logs.tts}</pre>
          </div>
        )}
      </div>

      <div className="panel">
        <div className="panel-header">
          <div>
            <h3>Live2Dオーバーレイ動画</h3>
            <p>overlay webm + lip_sync を生成します。</p>
            {canRun._motionOptional ? <div className="hint">live2d_motion.json が無い場合はデフォルト挙動で進みます</div> : null}
          </div>
          <div className="panel-actions">
            <button
              className="ghost"
              onClick={() => runStep('live2d', project?.steps?.live2d?.status === 'SUCCESS')}
              disabled={loadingStep !== null || !canRun.live2d}
              title={!canRun.live2d ? disabledReason('live2d') : undefined}
            >
              実行
            </button>
            <button className="ghost" onClick={() => runStep('live2d', true)} disabled={loadingStep !== null || !canRun.live2d} title={!canRun.live2d ? disabledReason('live2d') : undefined}>
              強制
            </button>
            <button className="ghost" onClick={() => loadLog('live2d')}>
              ログ取得
            </button>
          </div>
        </div>

        {settingsDraft ? (
          <div className="detail-grid">
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
            <div className="detail" style={{ gridColumn: '1 / -1' }}>
              <button className="ghost" onClick={onSaveSettings}>
                設定保存
              </button>
            </div>
          </div>
        ) : null}

        <div className="step-body">
          <div>
            <div className="label">overlay.webm</div>
            {project?.outputs.overlay_webm ? <video controls src={artifactUrl(project.outputs.overlay_webm)} /> : <div className="empty">まだ overlay がありません</div>}
          </div>
        </div>

        {logs.live2d && (
          <div className="log-block">
            <div className="label">ログ（末尾）</div>
            <pre className="code-block">{logs.live2d}</pre>
          </div>
        )}
      </div>

      <div className="panel">
        <div className="panel-header">
          <div>
            <h3>最終合成</h3>
            <p>overlay + 音声mix + （任意で）字幕焼き込み。</p>
          </div>
          <div className="panel-actions">
            <button
              className="ghost"
              onClick={() => runStep('compose', project?.steps?.compose?.status === 'SUCCESS')}
              disabled={loadingStep !== null || !canRun.compose}
              title={!canRun.compose ? disabledReason('compose') : undefined}
            >
              実行
            </button>
            <button className="ghost" onClick={() => runStep('compose', true)} disabled={loadingStep !== null || !canRun.compose} title={!canRun.compose ? disabledReason('compose') : undefined}>
              強制
            </button>
            <button className="ghost" onClick={() => loadLog('compose')}>
              ログ取得
            </button>
          </div>
        </div>

        {settingsDraft ? (
          <div className="detail-grid">
            <label className="detail">
              <span className="label">TTS volume</span>
              <input
                className="input"
                type="number"
                step="0.05"
                value={settingsDraft.audio.tts_volume}
                onChange={(e) =>
                  setSettingsDraft({
                    ...settingsDraft,
                    audio: { ...settingsDraft.audio, tts_volume: Number(e.target.value) },
                  })
                }
              />
            </label>
            <label className="detail">
              <span className="label">BGM volume</span>
              <input
                className="input"
                type="number"
                step="0.05"
                value={settingsDraft.audio.bgm_volume}
                onChange={(e) =>
                  setSettingsDraft({
                    ...settingsDraft,
                    audio: { ...settingsDraft.audio, bgm_volume: Number(e.target.value) },
                  })
                }
              />
            </label>
            <label className="detail">
              <span className="label">Ducking</span>
              <select
                className="input"
                value={settingsDraft.audio.ducking ? 'yes' : 'no'}
                onChange={(e) =>
                  setSettingsDraft({
                    ...settingsDraft,
                    audio: { ...settingsDraft.audio, ducking: e.target.value === 'yes' },
                  })
                }
              >
                <option value="yes">はい</option>
                <option value="no">いいえ</option>
              </select>
            </label>
            <label className="detail">
              <span className="label">字幕焼き込み</span>
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
                <option value="yes">はい</option>
                <option value="no">いいえ</option>
              </select>
            </label>
            <div className="detail" style={{ gridColumn: '1 / -1' }}>
              <button className="ghost" onClick={onSaveSettings}>
                設定保存
              </button>
            </div>
          </div>
        ) : null}

        <div className="step-body">
          <div>
            <div className="label">final.mp4</div>
            {project?.outputs.final_mp4 ? <video controls src={artifactUrl(project.outputs.final_mp4)} /> : <div className="empty">まだ最終 mp4 がありません</div>}
            {project?.outputs.final_with_subs_mp4 ? (
              <a className="link" href={artifactUrl(project.outputs.final_with_subs_mp4)} target="_blank" rel="noreferrer">
                final_with_subs.mp4 を開く
              </a>
            ) : null}
          </div>
        </div>

        {logs.compose && (
          <div className="log-block">
            <div className="label">ログ（末尾）</div>
            <pre className="code-block">{logs.compose}</pre>
          </div>
        )}
      </div>

      {error && <div className="error">{error}</div>}
    </div>
  );
}

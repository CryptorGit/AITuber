import React, { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { apiGet, apiPost } from '../api';

type DetailResponse = {
  meta: any;
  record: any;
};

type ExportJob = {
  battle_id: string;
  job_id?: string;
  status: 'queued' | 'running' | 'done' | 'failed';
  progress?: number;
  message?: string;
  download_url?: string;
};

export default function ReplayDetailPage() {
  const { battleId } = useParams();
  const decodedBattleId = useMemo(() => decodeURIComponent(battleId ?? ''), [battleId]);

  const [data, setData] = useState<DetailResponse | null>(null);
  const [err, setErr] = useState<string>('');

  const [job, setJob] = useState<ExportJob | null>(null);
  const [jobErr, setJobErr] = useState<string>('');

  const [subtitles, setSubtitles] = useState(false);

  useEffect(() => {
    if (!decodedBattleId) return;
    let cancelled = false;
    setErr('');
    apiGet<DetailResponse>(`/api/replays/${encodeURIComponent(decodedBattleId)}`)
      .then((r) => { if (!cancelled) setData(r); })
      .catch((e) => { if (!cancelled) setErr(String(e?.message ?? e)); });
    return () => { cancelled = true; };
  }, [decodedBattleId]);

  // poll export status while queued/running
  useEffect(() => {
    if (!job || (job.status !== 'queued' && job.status !== 'running')) return;
    const jobId = job.job_id;
    const t = setInterval(() => {
      const url = jobId
        ? `/api/export/status?job_id=${encodeURIComponent(jobId)}`
        : `/api/export/status?battle_id=${encodeURIComponent(decodedBattleId)}`;
      fetch(url)
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => j && setJob(j))
        .catch(() => {});
    }, 1500);
    return () => clearInterval(t);
  }, [job, decodedBattleId]);

  const viewerUrl = `/viewer/${encodeURIComponent(decodedBattleId)}?autoplay=1&embed=1&subtitles=${subtitles ? '1' : '0'}`;

  return (
    <div style={{ maxWidth: '100%', overflowX: 'hidden' }}>
      <div style={{ marginBottom: 8 }}>
        <Link to="/replays">← back</Link>
      </div>

      <h2 style={{ margin: '8px 0 12px' }}>/replays/{decodedBattleId}</h2>

      {err ? <div style={{ color: 'crimson' }}>{err}</div> : null}

      {data ? (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 12 }}>
          <section>
            <h3>Export mp4</h3>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <button
                onClick={() => {
                  setJobErr('');
                  apiPost<ExportJob>('/api/export', { battle_id: decodedBattleId, black_battle_text_overlay: subtitles })
                    .then((j) => setJob(j))
                    .catch((e) => setJobErr(String(e?.message ?? e)));
                }}
              >
                Export mp4 (no audio)
              </button>
            </div>

            {jobErr ? <div style={{ color: 'crimson', marginTop: 8 }}>{jobErr}</div> : null}

            {job ? (
              <div style={{ marginTop: 8 }}>
                no-audio: {job.status} {job.progress != null ? `(${Math.round(job.progress * 100)}%)` : ''} {job.message ?? ''}
                {job.status === 'done' && job.download_url ? (
                  <div style={{ marginTop: 6 }}>
                    <a href={job.download_url} target="_blank" rel="noreferrer">Download mp4</a>
                  </div>
                ) : null}
              </div>
            ) : null}
          </section>

          <section>
            <h3>Replay viewer (Pokemon Showdown)</h3>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <input type="checkbox" checked={subtitles} onChange={(e) => setSubtitles(e.target.checked)} />
              black battle text overlay
            </label>
            <div style={{ border: '1px solid #ddd', borderRadius: 6, overflow: 'hidden', width: '100%', height: 460 }}>
              <iframe title="replay" src={viewerUrl} style={{ width: '100%', height: '100%', border: 0 }} />
            </div>
          </section>

          <section>
            <h3>Meta</h3>
            <pre
              style={{
                maxWidth: '100%',
                overflowX: 'auto',
                whiteSpace: 'pre-wrap',
                overflowWrap: 'anywhere',
                wordBreak: 'break-word',
                background: '#f6f6f6',
                padding: 12,
                borderRadius: 6,
              }}
            >
              {JSON.stringify(data.meta, null, 2)}
            </pre>
          </section>

          <section>
            <h3>Replay record (raw)</h3>
            <pre
              style={{
                maxWidth: '100%',
                overflowX: 'auto',
                whiteSpace: 'pre-wrap',
                overflowWrap: 'anywhere',
                wordBreak: 'break-word',
                background: '#f6f6f6',
                padding: 12,
                borderRadius: 6,
              }}
            >
              {JSON.stringify(data.record, null, 2)}
            </pre>
          </section>
        </div>
      ) : (
        <div>loading...</div>
      )}
    </div>
  );
}

import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiGet, ReplayListItem } from '../api';

type ListResponse = {
  page: number;
  pageSize: number;
  total: number;
  items: ReplayListItem[];
  formats: string[];
};

export default function ReplaysPage() {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  const [format, setFormat] = useState<string>('');
  const [winner, setWinner] = useState<string>('');
  const [opponentType, setOpponentType] = useState<string>('');
  const [minTurns, setMinTurns] = useState<string>('');
  const [maxTurns, setMaxTurns] = useState<string>('');
  const [q, setQ] = useState<string>('');

  const [data, setData] = useState<ListResponse | null>(null);
  const [err, setErr] = useState<string>('');

  const query = useMemo(() => {
    const params = new URLSearchParams();
    params.set('page', String(page));
    params.set('pageSize', String(pageSize));
    if (format) params.set('format', format);
    if (winner) params.set('winner', winner);
    if (opponentType) params.set('opponentType', opponentType);
    if (minTurns) params.set('minTurns', minTurns);
    if (maxTurns) params.set('maxTurns', maxTurns);
    if (q) params.set('q', q);
    return params.toString();
  }, [page, pageSize, format, winner, opponentType, minTurns, maxTurns, q]);

  useEffect(() => {
    let cancelled = false;
    setErr('');
    apiGet<ListResponse>(`/api/replays?${query}`)
      .then((r) => {
        if (!cancelled) setData(r);
      })
      .catch((e) => {
        if (!cancelled) setErr(String(e?.message ?? e));
      });
    return () => {
      cancelled = true;
    };
  }, [query]);

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div>
      <h2 style={{ margin: '8px 0 12px' }}>/replays</h2>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end', marginBottom: 12 }}>
        <label>
          Format
          <br />
          <select value={format} onChange={(e) => { setPage(1); setFormat(e.target.value); }}>
            <option value="">(all)</option>
            {(data?.formats ?? []).map((f) => (
              <option key={f} value={f}>{f}</option>
            ))}
          </select>
        </label>

        <label>
          Winner
          <br />
          <select value={winner} onChange={(e) => { setPage(1); setWinner(e.target.value); }}>
            <option value="">(all)</option>
            <option value="p1">p1</option>
            <option value="p2">p2</option>
            <option value="tie">tie</option>
            <option value="error">error</option>
          </select>
        </label>

        <label>
          Opponent type
          <br />
          <select value={opponentType} onChange={(e) => { setPage(1); setOpponentType(e.target.value); }}>
            <option value="">(all)</option>
            <option value="agent">agent</option>
            <option value="snapshot">snapshot</option>
            <option value="unknown">unknown</option>
          </select>
        </label>

        <label>
          Turns min
          <br />
          <input style={{ width: 90 }} value={minTurns} onChange={(e) => { setPage(1); setMinTurns(e.target.value); }} />
        </label>
        <label>
          Turns max
          <br />
          <input style={{ width: 90 }} value={maxTurns} onChange={(e) => { setPage(1); setMaxTurns(e.target.value); }} />
        </label>

        <label>
          Search battle_id
          <br />
          <input style={{ width: 240 }} value={q} onChange={(e) => { setPage(1); setQ(e.target.value); }} />
        </label>

        <label>
          Page size
          <br />
          <select value={pageSize} onChange={(e) => { setPage(1); setPageSize(Number(e.target.value)); }}>
            <option value={25}>25</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
            <option value={200}>200</option>
          </select>
        </label>
      </div>

      {err ? <div style={{ color: 'crimson' }}>{err}</div> : null}

      <div style={{ marginBottom: 8 }}>
        {data ? (
          <div>
            total: {data.total} / page {data.page} of {totalPages}
          </div>
        ) : (
          <div>loading...</div>
        )}
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'left', borderBottom: '1px solid #ddd' }}>battle_id</th>
            <th style={{ textAlign: 'left', borderBottom: '1px solid #ddd' }}>run_id</th>
            <th style={{ textAlign: 'left', borderBottom: '1px solid #ddd' }}>format</th>
            <th style={{ textAlign: 'left', borderBottom: '1px solid #ddd' }}>winner</th>
            <th style={{ textAlign: 'right', borderBottom: '1px solid #ddd' }}>turns</th>
            <th style={{ textAlign: 'left', borderBottom: '1px solid #ddd' }}>opponent</th>
            <th style={{ textAlign: 'right', borderBottom: '1px solid #ddd' }}>error_rate</th>
            <th style={{ textAlign: 'left', borderBottom: '1px solid #ddd' }}>timestamp</th>
          </tr>
        </thead>
        <tbody>
          {(data?.items ?? []).map((r) => (
            <tr key={r.battle_id}>
              <td style={{ borderBottom: '1px solid #eee', padding: '6px 4px' }}>
                <Link to={`/replays/${encodeURIComponent(r.battle_id)}`}>{r.battle_id}</Link>
              </td>
              <td style={{ borderBottom: '1px solid #eee', padding: '6px 4px' }}>{r.run_id}</td>
              <td style={{ borderBottom: '1px solid #eee', padding: '6px 4px' }}>{r.format}</td>
              <td style={{ borderBottom: '1px solid #eee', padding: '6px 4px' }}>{r.winner}</td>
              <td style={{ borderBottom: '1px solid #eee', padding: '6px 4px', textAlign: 'right' }}>{r.turns ?? ''}</td>
              <td style={{ borderBottom: '1px solid #eee', padding: '6px 4px' }}>{r.opponent_id}</td>
              <td style={{ borderBottom: '1px solid #eee', padding: '6px 4px', textAlign: 'right' }}>{r.error_rate ?? ''}</td>
              <td style={{ borderBottom: '1px solid #eee', padding: '6px 4px' }}>{r.timestamp ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Prev</button>
        <button disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>Next</button>
      </div>
    </div>
  );
}

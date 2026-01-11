import React, { useEffect, useMemo, useRef, useState } from 'react';
import { apiMoveSearch, DexMoveDetail } from '../api';

type Props = {
  label: string;
  value: string;
  onChange: (next: string) => void;
  allowEmpty?: boolean;
};

function fmtAcc(acc: number) {
  if (!Number.isFinite(acc) || acc <= 0) return '--';
  return String(acc);
}

function fmtPow(p: number) {
  if (!Number.isFinite(p) || p <= 0) return '--';
  return String(p);
}

export default function MovePicker({ label, value, onChange, allowEmpty }: Props) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [items, setItems] = useState<DexMoveDetail[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);

  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      const el = rootRef.current;
      if (!el) return;
      if (e.target instanceof Node && !el.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const selectedLabel = value || '(none)';

  const effectiveQ = useMemo(() => {
    const s = q.trim();
    if (s) return s;
    // When opening, seed with the current value to make it easy to tweak.
    return '';
  }, [q]);

  useEffect(() => {
    if (!open) return;
    setActiveIndex(0);
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setActiveIndex(0);
  }, [open, effectiveQ]);

  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector(`[data-idx="${activeIndex}"]`) as HTMLElement | null;
    el?.scrollIntoView({ block: 'nearest' });
  }, [open, activeIndex, items.length]);

  useEffect(() => {
    if (!open) return;
    const qq = effectiveQ.trim();
    if (!qq) {
      setItems([]);
      setErr('');
      return;
    }

    let cancelled = false;
    setLoading(true);
    setErr('');
    const t = setTimeout(() => {
      apiMoveSearch(qq, 180)
        .then((r) => {
          if (!cancelled) setItems(r.items);
        })
        .catch((e) => {
          if (!cancelled) setErr(String(e?.message ?? e));
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 150);

    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [open, effectiveQ]);

  return (
    <div ref={rootRef} style={{ position: 'relative' }}>
      <div style={{ fontSize: 12, color: '#555', marginBottom: 4 }}>{label}</div>

      <button
        type="button"
        onClick={() => {
          setOpen((o) => !o);
          if (!open) setQ('');
        }}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '6px 8px',
          border: '1px solid #ccc',
          borderRadius: 6,
          background: 'white',
          textAlign: 'left',
          cursor: 'pointer',
        }}
      >
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selectedLabel}</span>
        <span style={{ color: '#666' }}>{open ? '▲' : '▼'}</span>
      </button>

      {open ? (
        <div
          style={{
            position: 'absolute',
            zIndex: 60,
            top: '100%',
            left: 0,
            right: 0,
            marginTop: 4,
            border: '1px solid #ccc',
            borderRadius: 6,
            background: 'white',
            boxShadow: '0 2px 10px rgba(0,0,0,0.08)',
            overflow: 'hidden',
          }}
        >
          <div style={{ padding: 8, borderBottom: '1px solid #eee' }}>
            <input
              ref={inputRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.preventDefault();
                  setOpen(false);
                  return;
                }
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  if (!items.length) return;
                  setActiveIndex((i) => Math.min(items.length - 1, Math.max(0, i + 1)));
                  return;
                }
                if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  if (!items.length) return;
                  setActiveIndex((i) => Math.max(0, i - 1));
                  return;
                }
                if (e.key === 'Enter') {
                  const it = items[activeIndex];
                  if (!it) return;
                  e.preventDefault();
                  onChange(it.name);
                  setOpen(false);
                }
              }}
              placeholder="Search moves..."
              style={{ width: '100%', padding: '6px 8px', border: '1px solid #ddd', borderRadius: 6 }}
            />
            {allowEmpty ? (
              <button
                type="button"
                onClick={() => {
                  onChange('');
                  setOpen(false);
                }}
                style={{ marginTop: 6 }}
              >
                Clear
              </button>
            ) : null}
            {err ? <div style={{ marginTop: 6, color: 'crimson', fontSize: 12 }}>{err}</div> : null}
            {loading ? <div style={{ marginTop: 6, color: '#666', fontSize: 12 }}>loading...</div> : null}
          </div>

          <div ref={listRef} style={{ maxHeight: 360, overflow: 'auto' }}>
            {items.length ? (
              <div style={{ minWidth: 680 }}>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '220px 70px 70px 80px 60px 1fr',
                    gap: 8,
                    padding: '8px 10px',
                    fontSize: 12,
                    color: '#666',
                    borderBottom: '1px solid #eee',
                    background: '#fafafa',
                    position: 'sticky',
                    top: 0,
                    zIndex: 1,
                  }}
                >
                  <div>Move</div>
                  <div>Type</div>
                  <div>Power</div>
                  <div>Accuracy</div>
                  <div>PP</div>
                  <div>Description</div>
                </div>
                {items.map((m, idx) => (
                  <button
                    key={m.id}
                    type="button"
                    data-idx={idx}
                    onClick={() => {
                      onChange(m.name);
                      setOpen(false);
                    }}
                    style={{
                      width: '100%',
                      border: 0,
                      background: activeIndex === idx ? '#f5f5f5' : 'white',
                      cursor: 'pointer',
                      padding: 0,
                    }}
                  >
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '220px 70px 70px 80px 60px 1fr',
                        gap: 8,
                        padding: '8px 10px',
                        borderBottom: '1px solid #f2f2f2',
                        textAlign: 'left',
                        alignItems: 'start',
                      }}
                    >
                      <div style={{ fontWeight: 600 }}>{m.name}</div>
                      <div>{m.type}</div>
                      <div>{fmtPow(m.basePower)}</div>
                      <div>{fmtAcc(m.accuracy)}</div>
                      <div>{m.pp || '--'}</div>
                      <div style={{ color: '#444', fontSize: 12 }}>{m.desc}</div>
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div style={{ padding: 10, color: '#666' }}>{q.trim() ? 'no results' : 'type to search'}</div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

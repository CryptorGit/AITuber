import React, { useEffect, useMemo, useRef, useState } from 'react';

export type ComboItem = {
  id: string;
  name: string;
  icon_url?: string;
  icon?: { kind: 'sheet'; url: string; size: number; x: number; y: number };
};

type Props = {
  label: string;
  value: string;
  onChange: (next: string) => void;
  items: ComboItem[];
  placeholder?: string;
  allowEmpty?: boolean;
};

export default function IconCombobox({ label, value, onChange, items, placeholder, allowEmpty }: Props) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
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

  const selected = useMemo(() => {
    const needle = value.trim().toLowerCase();
    if (!needle) return null;
    return items.find((it) => it.id.toLowerCase() === needle || it.name.toLowerCase() === needle) ?? null;
  }, [items, value]);

  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase();
    // If the list is small enough, allow browsing without typing.
    // For very large lists (e.g. moves), encourage search to avoid rendering thousands of rows.
    if (!qq) {
      const browseCap = items.length <= 1500 ? items.length : 300;
      return items.slice(0, browseCap);
    }

    const toIDLike = (text: string) => String(text ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
    const score = (name: string, id: string, queryRaw: string): number | null => {
      const qRaw = String(queryRaw ?? '').trim().toLowerCase();
      const qId = toIDLike(qRaw);
      if (!qId) return null;

      const idLower = String(id ?? '').toLowerCase();
      const nameLower = String(name ?? '').toLowerCase();
      const nameId = toIDLike(nameLower);

      const tokens = qRaw.split(/\s+/g).filter(Boolean);
      for (const t of tokens) {
        const tId = toIDLike(t);
        if (!tId) continue;
        if (!nameId.includes(tId) && !idLower.includes(tId) && !nameLower.includes(t)) return null;
      }

      if (idLower === qId) return 0;
      if (nameId === qId) return 1;
      if (idLower.startsWith(qId)) return 2;
      if (nameId.startsWith(qId)) return 3;
      if (nameLower.startsWith(qRaw)) return 4;
      const words = nameLower.split(/[\s\-]+/g).filter(Boolean);
      for (const w of words) {
        if (toIDLike(w).startsWith(qId)) return 5;
      }
      if (nameId.includes(qId) || idLower.includes(qId)) return 6;
      if (nameLower.includes(qRaw)) return 7;
      return null;
    };

    const scored: Array<{ it: ComboItem; score: number }> = [];
    for (const it of items) {
      const s = score(it.name, it.id, qq);
      if (s === null) continue;
      scored.push({ it, score: s });
    }
    scored.sort((a, b) => {
      if (a.score !== b.score) return a.score - b.score;
      const an = a.it.name.length;
      const bn = b.it.name.length;
      if (an !== bn) return an - bn;
      return a.it.name.localeCompare(b.it.name);
    });
    return scored.slice(0, 400).map((x) => x.it);
  }, [items, q]);

  useEffect(() => {
    if (!open) return;
    setActiveIndex(0);
    // focus search box on open
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setActiveIndex(0);
  }, [open, q]);

  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector(`[data-idx="${activeIndex}"]`) as HTMLElement | null;
    el?.scrollIntoView({ block: 'nearest' });
  }, [open, activeIndex]);

  const renderIcon = (it: ComboItem | null) => {
    if (!it) return <span style={{ width: 22, height: 22 }} />;
    if (it.icon?.kind === 'sheet') {
      // Showdown item icons are in a sprite sheet (24px tiles). We render the 24px tile and scale to 22px.
      const scale = 22 / it.icon.size;
      return (
        <span aria-hidden style={{ width: 22, height: 22, overflow: 'hidden', display: 'inline-block' }}>
          <span
            style={{
              width: it.icon.size,
              height: it.icon.size,
              display: 'block',
              backgroundImage: `url(${it.icon.url})`,
              backgroundRepeat: 'no-repeat',
              backgroundPosition: `-${it.icon.x}px -${it.icon.y}px`,
              transform: `scale(${scale})`,
              transformOrigin: 'top left',
            }}
          />
        </span>
      );
    }
    if (it.icon_url) return <img src={it.icon_url} alt="" width={22} height={22} />;
    return <span style={{ width: 22, height: 22 }} />;
  };

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
        {renderIcon(selected)}
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {selected ? selected.name : value ? value : placeholder ?? '(select)'}
        </span>
        <span style={{ color: '#666' }}>{open ? '▲' : '▼'}</span>
      </button>

      {open ? (
        <div
          style={{
            position: 'absolute',
            zIndex: 50,
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
                  if (!filtered.length) return;
                  setActiveIndex((i) => Math.min(filtered.length - 1, Math.max(0, i + 1)));
                  return;
                }
                if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  if (!filtered.length) return;
                  setActiveIndex((i) => Math.max(0, i - 1));
                  return;
                }
                if (e.key === 'Enter') {
                  const it = filtered[activeIndex];
                  if (!it) return;
                  e.preventDefault();
                  onChange(it.name);
                  setOpen(false);
                }
              }}
              placeholder="search..."
              style={{ width: '100%', padding: '6px 8px', border: '1px solid #ddd', borderRadius: 6 }}
            />
            {!q.trim() && items.length > 1500 ? (
              <div style={{ marginTop: 6, fontSize: 12, color: '#666' }}>Type to search (showing first 300 of {items.length})</div>
            ) : null}
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
          </div>
          <div ref={listRef} style={{ maxHeight: 320, overflow: 'auto' }}>
            {filtered.map((it, idx) => (
              <button
                key={it.id}
                type="button"
                data-idx={idx}
                onClick={() => {
                  onChange(it.name);
                  setOpen(false);
                }}
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '6px 8px',
                  border: 0,
                  background: activeIndex === idx ? '#f5f5f5' : 'white',
                  cursor: 'pointer',
                }}
              >
                {renderIcon(it)}
                <span style={{ flex: 1, textAlign: 'left' }}>{it.name}</span>
                <span style={{ color: '#888', fontSize: 12 }}>{it.id}</span>
              </button>
            ))}
            {filtered.length === 0 ? <div style={{ padding: 8, color: '#666' }}>no results</div> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

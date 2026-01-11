import React, { useEffect, useMemo, useState } from 'react';
import { apiDexList, apiGet, apiPut, DexListItem } from '../api';
import IconCombobox from '../components/IconCombobox';

type PoolEntry = {
  name: string;
  species: string;
  level: number;
  gender: '' | 'M' | 'F';
  shiny: boolean;
  happiness: number;
  item: string;
  ability: string;
  nature: string;
  evs: any;
  ivs: any;
  moves: string[];
  teraType: string;
  hpType?: string;
  pokeball?: string;
  gigantamax?: boolean;
  dynamaxLevel?: number;
};

type PoolConfig = {
  version: 1;
  updated_at?: string;
  pool: PoolEntry[];
};

function renderDexIcon(it: DexListItem | undefined, sizePx: number) {
  if (!it) return null;
  if (it.icon?.kind === 'sheet') {
    const scale = sizePx / it.icon.size;
    return (
      <span aria-hidden style={{ width: sizePx, height: sizePx, overflow: 'hidden', display: 'inline-block' }}>
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
  if (it.icon_url) return <img src={it.icon_url} alt="" width={sizePx} height={sizePx} />;
  return null;
}

const emptyEntry = (): PoolEntry => ({
  name: '',
  species: '',
  level: 50,
  gender: '',
  shiny: false,
  happiness: 255,
  item: '',
  ability: '',
  nature: '',
  evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
  ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
  moves: ['', '', '', ''],
  teraType: '',
  hpType: '',
  pokeball: '',
  gigantamax: false,
  dynamaxLevel: 10,
});

const statKeys = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'] as const;
type StatKey = (typeof statKeys)[number];

function clampInt(v: unknown, min: number, max: number) {
  const n = Number(v);
  if (Number.isNaN(n)) return min;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function sumEvs(evs: any) {
  return statKeys.reduce((acc, k) => acc + (Number(evs?.[k] ?? 0) || 0), 0);
}

const genderItems: DexListItem[] = [
  { id: '', name: '(any)' },
  { id: 'm', name: 'M' },
  { id: 'f', name: 'F' },
];

export default function PoolPage() {
  const [cfg, setCfg] = useState<PoolConfig | null>(null);
  const [err, setErr] = useState('');
  const [saveMsg, setSaveMsg] = useState('');

  const [selectedIndex, setSelectedIndex] = useState<number>(0);

  const [speciesList, setSpeciesList] = useState<DexListItem[]>([]);
  const [itemList, setItemList] = useState<DexListItem[]>([]);
  const [natureList, setNatureList] = useState<DexListItem[]>([]);
  const [typeList, setTypeList] = useState<DexListItem[]>([]);

  const [quickSpecies, setQuickSpecies] = useState('');
  const [bulkSpecies, setBulkSpecies] = useState('');
  const [setText, setSetText] = useState('');
  const [setTextErr, setSetTextErr] = useState('');

  useEffect(() => {
    setErr('');
    apiGet<PoolConfig>('/api/config/pool')
      .then((r) => setCfg(r))
      .catch((e) => setErr(String(e?.message ?? e)));
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      apiDexList('species'),
      apiDexList('items'),
      apiDexList('natures'),
      apiDexList('types'),
    ])
      .then(([s, it, nat, types]) => {
        if (cancelled) return;
        setSpeciesList(s.items);
        setItemList(it.items);
        setNatureList(nat.items);
        setTypeList(types.items);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const speciesByName = useMemo(() => {
    const m = new Map<string, DexListItem>();
    for (const s of speciesList) m.set(s.name.toLowerCase(), s);
    return m;
  }, [speciesList]);

  const itemByName = useMemo(() => {
    const m = new Map<string, DexListItem>();
    for (const it of itemList) m.set(it.name.toLowerCase(), it);
    return m;
  }, [itemList]);

  const pool = cfg?.pool ?? [];
  const safeSelectedIndex = Math.max(0, Math.min(selectedIndex, Math.max(0, pool.length - 1)));
  const selected = pool[safeSelectedIndex] ?? null;
  const selectedSpecies = selected?.species ?? '';

  const styles = useMemo(() => {
    const card: React.CSSProperties = { border: '1px solid #ddd', borderRadius: 8, background: 'white' };
    return {
      page: { padding: 16, maxWidth: 1200, margin: '0 auto' } as React.CSSProperties,
      headerRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 } as React.CSSProperties,
      title: { fontSize: 20, fontWeight: 900, margin: 0 } as React.CSSProperties,
      sub: { color: '#666', fontSize: 12 } as React.CSSProperties,
      card,
      cardHeader: {
        padding: '10px 12px',
        borderBottom: '1px solid #eee',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8,
      } as React.CSSProperties,
      cardBody: { padding: 12 } as React.CSSProperties,
      input: { width: '100%', padding: '8px 10px', border: '1px solid #ccc', borderRadius: 8 } as React.CSSProperties,
      btn: { padding: '8px 12px', borderRadius: 8, border: '1px solid #ccc', background: 'white', cursor: 'pointer' } as React.CSSProperties,
      btnPrimary: { padding: '8px 12px', borderRadius: 8, border: '1px solid #bbb', background: '#f5f5f5', cursor: 'pointer', fontWeight: 800 } as React.CSSProperties,
    };
  }, []);

  // IMPORTANT: do not early-return before running hooks; otherwise hook order changes between renders.

  const normalizeSpecies = (s: string) => s.trim();

  const parseShowdownSets = (text: string): PoolEntry[] => {
    const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n');

    const out: PoolEntry[] = [];
    let block: string[] = [];
    const flush = () => {
      const b = block.map((s) => s.trimEnd()).filter((s) => s.trim().length > 0);
      block = [];
      if (!b.length) return;

      const entry = emptyEntry();
      entry.moves = [];

      const header = b[0];
      const mItem = /^(.*?)\s*@\s*(.+)$/.exec(header);
      const left = (mItem ? mItem[1] : header).trim();
      const item = (mItem ? mItem[2] : '').trim();
      if (item) entry.item = item;

      // Gender suffix: "(... ) (M)" or "... (F)"
      let leftNoGender = left;
      const mGender = /^(.*)\s*\((M|F)\)\s*$/.exec(leftNoGender);
      if (mGender) {
        leftNoGender = mGender[1].trim();
        entry.gender = mGender[2] as any;
      }

      // Nickname/species: "Nick (Species)" or "Species"
      const mNick = /^(.*)\(([^()]+)\)\s*$/.exec(leftNoGender);
      if (mNick) {
        const nick = mNick[1].trim();
        const sp = mNick[2].trim();
        entry.species = sp;
        if (nick && nick.toLowerCase() !== sp.toLowerCase()) entry.name = nick;
      } else {
        entry.species = leftNoGender.trim();
      }

      for (let i = 1; i < b.length; i++) {
        const line = b[i].trim();
        if (!line) continue;

        if (line.startsWith('-')) {
          const mv = line.replace(/^-\s*/, '').trim();
          if (mv) entry.moves.push(mv);
          continue;
        }

        let m: RegExpExecArray | null;
        if ((m = /^Ability:\s*(.+)$/.exec(line))) {
          entry.ability = m[1].trim();
          continue;
        }
        if ((m = /^Level:\s*(\d+)/.exec(line))) {
          entry.level = Number(m[1]) || entry.level;
          continue;
        }
        if ((m = /^Happiness:\s*(\d+)/.exec(line))) {
          entry.happiness = Number(m[1]) || entry.happiness;
          continue;
        }
        if ((m = /^Shiny:\s*(Yes|No)/i.exec(line))) {
          entry.shiny = m[1].toLowerCase() === 'yes';
          continue;
        }
        if ((m = /^Tera\s*Type:\s*(.+)$/i.exec(line))) {
          entry.teraType = m[1].trim();
          continue;
        }
        if ((m = /^Nature:\s*(.+)$/i.exec(line))) {
          entry.nature = m[1].trim();
          continue;
        }
        if ((m = /^(.+)\s+Nature$/i.exec(line))) {
          entry.nature = m[1].trim();
          continue;
        }
        if ((m = /^EVs:\s*(.+)$/i.exec(line))) {
          const parts = m[1].split('/').map((p) => p.trim()).filter(Boolean);
          const mapKey = (s: string): keyof typeof entry.evs | null => {
            const t = s.toLowerCase().replace(/\./g, '');
            if (t === 'hp') return 'hp';
            if (t === 'atk' || t === 'attack') return 'atk';
            if (t === 'def' || t === 'defense') return 'def';
            if (t === 'spa' || t === 'spatk' || t === 'specialattack') return 'spa';
            if (t === 'spd' || t === 'spdef' || t === 'specialdefense') return 'spd';
            if (t === 'spe' || t === 'speed') return 'spe';
            return null;
          };
          for (const p of parts) {
            const mm = /^(\d+)\s+(.+)$/.exec(p);
            if (!mm) continue;
            const stat = mapKey(mm[2].trim());
            if (!stat) continue;
            entry.evs[stat] = Number(mm[1]) || 0;
          }
          continue;
        }
        if ((m = /^IVs:\s*(.+)$/i.exec(line))) {
          const parts = m[1].split('/').map((p) => p.trim()).filter(Boolean);
          const mapKey = (s: string): keyof typeof entry.ivs | null => {
            const t = s.toLowerCase().replace(/\./g, '');
            if (t === 'hp') return 'hp';
            if (t === 'atk' || t === 'attack') return 'atk';
            if (t === 'def' || t === 'defense') return 'def';
            if (t === 'spa' || t === 'spatk' || t === 'specialattack') return 'spa';
            if (t === 'spd' || t === 'spdef' || t === 'specialdefense') return 'spd';
            if (t === 'spe' || t === 'speed') return 'spe';
            return null;
          };
          for (const p of parts) {
            const mm = /^(\d+)\s+(.+)$/.exec(p);
            if (!mm) continue;
            const stat = mapKey(mm[2].trim());
            if (!stat) continue;
            entry.ivs[stat] = Number(mm[1]) || 0;
          }
          continue;
        }
        if ((m = /^Dynamax\s*Level:\s*(\d+)/i.exec(line))) {
          entry.dynamaxLevel = Number(m[1]) || entry.dynamaxLevel;
          continue;
        }
        if ((m = /^Gigantamax:\s*(Yes|No)/i.exec(line))) {
          entry.gigantamax = m[1].toLowerCase() === 'yes';
          continue;
        }
        if ((m = /^Pokeball:\s*(.+)$/i.exec(line))) {
          entry.pokeball = m[1].trim();
          continue;
        }
        if ((m = /^(HP\s*Type|Hidden\s*Power)\s*:\s*(.+)$/i.exec(line))) {
          entry.hpType = m[2].trim();
          continue;
        }
      }

      const moves = (entry.moves ?? []).slice(0, 4);
      while (moves.length < 4) moves.push('');
      entry.moves = moves;

      if (entry.species.trim()) out.push(entry);
    };

    for (const raw of lines) {
      if (raw.trim().length === 0) {
        flush();
        continue;
      }
      block.push(raw);
    }
    flush();
    return out;
  };



  const formatShowdownSet = (e: PoolEntry): string => {
    const lines: string[] = [];

    const headerLeft = (() => {
      const sp = (e.species ?? '').trim();
      const nick = (e.name ?? '').trim();
      const gender = (e.gender ?? '').trim();
      if (!sp && nick) return nick;
      if (!sp) return '';
      if (nick && nick.toLowerCase() !== sp.toLowerCase()) return `${nick} (${sp})`;
      return sp;
    })();

    const header = [headerLeft, e.item ? `@ ${e.item}` : ''].filter(Boolean).join(' ');
    if (header.trim()) {
      lines.push(headerLeft + (e.gender ? ` (${e.gender})` : '') + (e.item ? ` @ ${e.item}` : ''));
    } else {
      lines.push('');
    }

    if (e.ability) lines.push(`Ability: ${e.ability}`);
    if (Number.isFinite(Number(e.level)) && Number(e.level) !== 100) lines.push(`Level: ${Number(e.level)}`);
    if (e.shiny) lines.push('Shiny: Yes');
    if (Number.isFinite(Number(e.happiness)) && Number(e.happiness) !== 255) lines.push(`Happiness: ${Number(e.happiness)}`);
    if (e.teraType) lines.push(`Tera Type: ${e.teraType}`);

    const evParts: string[] = [];
    for (const k of statKeys) {
      const v = Number(e.evs?.[k] ?? 0) || 0;
      if (v > 0) {
        const label = k === 'hp' ? 'HP' : k === 'atk' ? 'Atk' : k === 'def' ? 'Def' : k === 'spa' ? 'SpA' : k === 'spd' ? 'SpD' : 'Spe';
        evParts.push(`${v} ${label}`);
      }
    }
    if (evParts.length) lines.push(`EVs: ${evParts.join(' / ')}`);

    if (e.nature) lines.push(`${e.nature} Nature`);

    const ivParts: string[] = [];
    for (const k of statKeys) {
      const v = Number(e.ivs?.[k] ?? 31);
      if (Number.isFinite(v) && v !== 31) {
        const label = k === 'hp' ? 'HP' : k === 'atk' ? 'Atk' : k === 'def' ? 'Def' : k === 'spa' ? 'SpA' : k === 'spd' ? 'SpD' : 'Spe';
        ivParts.push(`${v} ${label}`);
      }
    }
    if (ivParts.length) lines.push(`IVs: ${ivParts.join(' / ')}`);

    if (e.hpType) lines.push(`Hidden Power: ${e.hpType}`);
    if (e.pokeball) lines.push(`Pokeball: ${e.pokeball}`);
    if (e.gigantamax) lines.push('Gigantamax: Yes');
    if (e.dynamaxLevel != null && Number.isFinite(Number(e.dynamaxLevel)) && Number(e.dynamaxLevel) !== 10) lines.push(`Dynamax Level: ${Number(e.dynamaxLevel)}`);

    const moves = (e.moves ?? []).filter((m) => String(m ?? '').trim().length > 0);
    for (const m of moves.slice(0, 4)) lines.push(`- ${m}`);

    return lines.join('\n').trimEnd();
  };

  useEffect(() => {
    // When switching selection, refresh the text editor to match the selected entry.
    if (!selected) {
      setSetText('');
      setSetTextErr('');
      return;
    }
    setSetText(formatShowdownSet(selected));
    setSetTextErr('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [safeSelectedIndex]);

  if (!cfg) return <div>{err ? <span style={{ color: 'crimson' }}>{err}</span> : 'loading...'}</div>;

  const updateEntry = (i: number, patch: Partial<PoolEntry>) => {
    const next: PoolConfig = { ...cfg, pool: cfg.pool.map((p, idx) => (idx === i ? { ...p, ...patch } : p)) };
    setCfg(next);
  };

  const addSpeciesList = (speciesList: string[]) => {
    const cleaned = speciesList.map(normalizeSpecies).filter(Boolean);
    if (!cleaned.length) return;

    const existing = new Set((cfg.pool ?? []).map((p) => normalizeSpecies(p.species).toLowerCase()));
    const toAdd = cleaned.filter((s) => !existing.has(s.toLowerCase()));
    if (!toAdd.length) return;

    setCfg({
      ...cfg,
      pool: [...cfg.pool, ...toAdd.map((s) => ({ ...emptyEntry(), species: s }))],
    });
  };

  if (!cfg) return <div>{err ? <span style={{ color: 'crimson' }}>{err}</span> : 'loading...'}</div>;

  const applySetText = () => {
    const parsed = parseShowdownSets(setText);
    if (!parsed.length) {
      setSetTextErr('Parse failed: no valid set found (needs at least a Species line).');
      return;
    }
    const next = parsed[0];
    if (!next.species.trim()) {
      setSetTextErr('Parse failed: Species is empty.');
      return;
    }
    setSetTextErr('');
    updateEntry(safeSelectedIndex, next);
  };

  return (
    <div style={styles.page}>
      <div style={styles.headerRow}>
        <div>
          <h2 style={styles.title}>Pool</h2>
          <div style={styles.sub}>保存先: config/pokemon-showdown/vgc-demo/pool.json</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {err ? <div style={{ color: 'crimson' }}>{err}</div> : null}
          {saveMsg ? <div style={{ color: '#0a7', fontWeight: 800 }}>{saveMsg}</div> : null}
          <button
            style={styles.btnPrimary}
            onClick={() => {
              setErr('');
              setSaveMsg('');
              apiPut<PoolConfig>('/api/config/pool', cfg)
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

      <div style={{ ...styles.card, marginTop: 12, marginBottom: 12 }}>
        <div style={styles.cardHeader}>
          <div style={{ fontWeight: 800 }}>追加</div>
        </div>
        <div style={styles.cardBody}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ minWidth: 260 }}>
            <IconCombobox label="species" value={quickSpecies} onChange={setQuickSpecies} items={speciesList} placeholder="Pick a Pokemon" />
          </div>
          <button
            style={styles.btn}
            onClick={() => {
              const before = cfg.pool.length;
              addSpeciesList([quickSpecies]);
              setQuickSpecies('');
              if (cfg.pool.length === before) setSelectedIndex(Math.max(0, cfg.pool.length - 1));
            }}
          >
            Add
          </button>
          <button
            style={styles.btn}
            onClick={() => {
              setCfg({ ...cfg, pool: [...cfg.pool, emptyEntry()] });
              setSelectedIndex(cfg.pool.length);
            }}
          >
            Add blank
          </button>
        </div>

        <div style={{ marginTop: 10 }}>
          <div style={{ marginBottom: 6 }}>まとめて追加（1行1species / 重複はスキップ）</div>
          <textarea
            rows={3}
            style={{ ...styles.input, fontFamily: 'inherit' }}
            value={bulkSpecies}
            onChange={(e) => setBulkSpecies(e.target.value)}
            placeholder={'例:\nIncineroar\nRillaboom\nFlutter Mane'}
          />
          <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
            <button
              style={styles.btn}
              onClick={() => {
                addSpeciesList(bulkSpecies.split(/\r?\n/g));
                setBulkSpecies('');
              }}
            >
              Bulk add
            </button>
          </div>
        </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '360px 1fr', gap: 12, alignItems: 'start' }}>
        {/* Left roster list */}
        <div style={styles.card}>
          <div style={styles.cardHeader}>
            <div style={{ fontWeight: 800 }}>Pool ({pool.length})</div>
          </div>
          <div style={{ ...styles.cardBody, paddingTop: 10, maxHeight: 720, overflow: 'auto' }}>
          <div style={{ display: 'grid', gap: 6 }}>
            {pool.map((p, i) => {
              const icon = speciesByName.get((p.species || '').toLowerCase())?.icon_url;
              const item = itemByName.get((p.item || '').toLowerCase());
              const active = i === safeSelectedIndex;
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => setSelectedIndex(i)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    width: '100%',
                    padding: '6px 8px',
                    borderRadius: 8,
                    border: active ? '2px solid #888' : '1px solid #ddd',
                    background: active ? '#f5f5f5' : 'white',
                    cursor: 'pointer',
                    textAlign: 'left',
                  }}
                >
                  <span style={{ position: 'relative', width: 24, height: 24, display: 'inline-block' }}>
                    {icon ? <img src={icon} alt="" width={24} height={24} /> : <span style={{ width: 24, height: 24, display: 'inline-block' }} />}
                    {item ? (
                      <span style={{ position: 'absolute', right: -2, bottom: -2 }}>
                        {renderDexIcon(item, 18)}
                      </span>
                    ) : null}
                  </span>
                  <div style={{ flex: 1, overflow: 'hidden' }}>
                    <div style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name ? p.name : p.species || '(unset)'}</div>
                    <div style={{ fontSize: 12, color: '#666', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.species || ''}</div>
                  </div>
                </button>
              );
            })}
          </div>
          </div>
        </div>

        {/* Right editor */}
        <div style={styles.card}>
          {!selected ? (
            <div style={{ ...styles.cardBody, color: '#666' }}>No entries. Add a species.</div>
          ) : (
            <>
              <div style={styles.cardHeader}>
                <div style={{ fontWeight: 900 }}>Pokemon #{safeSelectedIndex + 1}</div>
                <button
                  style={styles.btn}
                  onClick={() => {
                    const nextPool = cfg.pool.filter((_, idx) => idx !== safeSelectedIndex);
                    setCfg({ ...cfg, pool: nextPool });
                    setSelectedIndex(Math.max(0, safeSelectedIndex - 1));
                  }}
                >
                  Delete
                </button>
              </div>

              <div style={styles.cardBody}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                  <div style={{ width: 48, height: 48 }}>
                    {selectedSpecies ? (
                      <img
                        src={speciesByName.get(selectedSpecies.toLowerCase())?.icon_url}
                        alt=""
                        width={48}
                        height={48}
                        style={{ imageRendering: 'auto' }}
                      />
                    ) : (
                      <div style={{ width: 48, height: 48, border: '1px solid #eee', borderRadius: 8, background: '#fafafa' }} />
                    )}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 800, fontSize: 14 }}>{selected.name || selected.species || '(unset)'}</div>
                    <div style={{ color: '#666', fontSize: 12 }}>Showdown形式で編集（Teambuilderと同じ見た目/順番）</div>
                  </div>
                  {selected.item ? (
                    <div title={selected.item} style={{ width: 28, height: 28 }}>
                      {renderDexIcon(itemByName.get(selected.item.toLowerCase()), 28)}
                    </div>
                  ) : null}
                </div>

                <textarea
                  rows={18}
                  style={{
                    ...styles.input,
                    fontFamily:
                      'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
                    lineHeight: 1.35,
                  }}
                  value={setText}
                  onChange={(e) => {
                    setSetText(e.target.value);
                    setSetTextErr('');
                  }}
                  onBlur={applySetText}
                  placeholder={'Incineroar @ Sitrus Berry\nAbility: Intimidate\nLevel: 50\nEVs: 252 HP / 4 Atk / 252 SpD\nCareful Nature\n- Fake Out\n- Flare Blitz\n- Parting Shot\n- Snarl'}
                />

                {setTextErr ? <div style={{ marginTop: 8, color: 'crimson' }}>{setTextErr}</div> : null}
                <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button style={styles.btn} onClick={applySetText}>
                    Apply
                  </button>
                  <button
                    style={styles.btn}
                    onClick={() => {
                      setSetText(formatShowdownSet(selected));
                      setSetTextErr('');
                    }}
                  >
                    Reset
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

import React, { useMemo, useState } from 'react';
import type { DexListItem, SpeciesDetail } from '../api';
import IconCombobox from './IconCombobox';
import MovePicker from './MovePicker';
import { BattleNatures, BattleStatNames, blankSet, exportSet, importTeam, PokemonSet, toID } from '../ps/showdownTeams';

const statKeys = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'] as const;

type Props = {
  speciesList: DexListItem[];
  itemList: DexListItem[];
  abilityList: DexListItem[];
  natureList: DexListItem[];
  typeList: DexListItem[];
  speciesDetail: SpeciesDetail | null;

  entryLabel: string;
  onDelete: () => void;

  set: PokemonSet;
  onChange: (next: PokemonSet) => void;
};

function clampInt(v: unknown, min: number, max: number) {
  const n = Number(v);
  if (Number.isNaN(n)) return min;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function sumEvs(evs: any) {
  return statKeys.reduce((acc, k) => acc + (Number(evs?.[k] ?? 0) || 0), 0);
}

export default function PoolEntryEditor({
  speciesList,
  itemList,
  abilityList,
  natureList,
  typeList,
  speciesDetail,
  entryLabel,
  onDelete,
  set: incomingSet,
  onChange,
}: Props) {
  const [ioText, setIoText] = useState('');
  const [ioErr, setIoErr] = useState('');

  const styles = useMemo(() => {
    const card: React.CSSProperties = { border: '1px solid #ddd', borderRadius: 8, background: 'white' };
    return {
      card,
      sectionTitle: { fontWeight: 900, marginBottom: 6 } as React.CSSProperties,
      input: { width: '100%', padding: '8px 10px', border: '1px solid #ccc', borderRadius: 8 } as React.CSSProperties,
      btn: { padding: '8px 12px', borderRadius: 8, border: '1px solid #ccc', background: 'white', cursor: 'pointer' } as React.CSSProperties,
      btnPrimary: { padding: '8px 12px', borderRadius: 8, border: '1px solid #bbb', background: '#f5f5f5', cursor: 'pointer', fontWeight: 800 } as React.CSSProperties,
      sub: { color: '#666', fontSize: 12 } as React.CSSProperties,
    };
  }, []);

  const set = incomingSet?.species ? incomingSet : blankSet('');
  const evTotal = sumEvs(set.evs);
  const evRemaining = 510 - evTotal;
  const natureEff = (BattleNatures as any)[set.nature as any] as { plus?: string; minus?: string } | undefined;

  const abilityItems = useMemo(() => {
    const allowed = speciesDetail?.abilities?.map((a) => toID(a)).filter(Boolean) ?? [];
    if (!allowed.length) return abilityList;
    const allowSet = new Set(allowed);
    const filtered = abilityList.filter((a) => allowSet.has(toID(a.name)));
    // Ensure any currently selected ability remains selectable (even if data mismatch).
    const cur = String(set.ability ?? '').trim();
    if (cur && !filtered.some((a) => toID(a.name) === toID(cur))) {
      return [{ id: toID(cur), name: cur }, ...filtered];
    }
    return filtered;
  }, [abilityList, set.ability, speciesDetail]);

  const evError = evTotal > 510 ? `EV total must be <= 510 (got ${evTotal})` : '';

  return (
    <div style={styles.card}>
      <div style={{ padding: '10px 12px', borderBottom: '1px solid #eee', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <div>
          <div style={{ fontWeight: 900 }}>{entryLabel}</div>
          <div style={styles.sub}>編集は即時に反映（Saveでpool.jsonへ保存）</div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <button type="button" style={styles.btn} onClick={onDelete}>
            Delete
          </button>
        </div>
      </div>

      <div style={{ padding: 12, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, alignItems: 'start' }}>
        {/* Left: form */}
        <div style={{ display: 'grid', gap: 12 }}>
          <div>
            <div style={styles.sectionTitle}>Pokemon</div>
            <IconCombobox
              label="species"
              value={set.species || ''}
              onChange={(next) => {
                const sp = next.trim();
                const prev = set.species;
                const nextSet: PokemonSet = { ...set, species: sp };
                // If current species was blank, seed defaults to VGC-ish.
                if (!prev && sp) {
                  const seeded = blankSet(sp);
                  // keep any existing edits
                  onChange({ ...seeded, ...nextSet, species: sp, moves: (nextSet.moves ?? seeded.moves) });
                  return;
                }
                onChange(nextSet);
              }}
              items={speciesList}
              placeholder="Pick a Pokemon"
            />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 10 }}>
              <div>
                <label style={styles.sub}>Nickname</label>
                <input
                  style={styles.input}
                  value={set.name ?? ''}
                  onChange={(e) => onChange({ ...set, name: e.target.value })}
                  placeholder="(optional)"
                />
              </div>
              <div>
                <label style={styles.sub}>Level</label>
                <input
                  type="number"
                  min={1}
                  max={100}
                  style={styles.input}
                  value={set.level ?? 50}
                  onChange={(e) => onChange({ ...set, level: clampInt(e.target.value, 1, 100) })}
                />
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 10 }}>
              <div>
                <IconCombobox
                  label="gender"
                  value={String(set.gender ?? '')}
                  onChange={(next) => onChange({ ...set, gender: next as any })}
                  items={[
                    { id: '', name: '(any)' },
                    { id: 'M', name: 'M' },
                    { id: 'F', name: 'F' },
                  ]}
                />
              </div>
              <div>
                <IconCombobox
                  label="tera type"
                  value={String(set.teraType ?? '')}
                  onChange={(next) => onChange({ ...set, teraType: next })}
                  items={[{ id: '', name: '(none)' }, ...typeList]}
                  allowEmpty
                />
              </div>
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
              <input
                type="checkbox"
                checked={Boolean(set.shiny)}
                onChange={(e) => onChange({ ...set, shiny: e.target.checked })}
              />
              <span>Shiny</span>
            </label>
          </div>

          <div>
            <div style={styles.sectionTitle}>Item / Ability</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <IconCombobox
                label="item"
                value={String(set.item ?? '')}
                onChange={(next) => onChange({ ...set, item: next })}
                items={[{ id: '', name: '(none)' }, ...itemList]}
                allowEmpty
              />
              <IconCombobox
                label="ability"
                value={String(set.ability ?? '')}
                onChange={(next) => onChange({ ...set, ability: next })}
                items={[{ id: '', name: '(none)' }, ...abilityItems]}
                allowEmpty
              />
            </div>
            {speciesDetail?.types?.length ? <div style={{ marginTop: 8, ...styles.sub }}>Types: {speciesDetail.types.join(' / ')}</div> : null}
            {speciesDetail?.abilities?.length ? (
              <div style={{ marginTop: 4, ...styles.sub }}>Suggested abilities: {speciesDetail.abilities.join(' / ')}</div>
            ) : null}
          </div>

          <div>
            <div style={styles.sectionTitle}>Moves</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {[0, 1, 2, 3].map((idx) => (
                <MovePicker
                  key={idx}
                  label={`move ${idx + 1}`}
                  value={String((set.moves ?? [])[idx] ?? '')}
                  allowEmpty
                  onChange={(next) => {
                    const nextMoves = (set.moves ? [...set.moves] : ['', '', '', '']);
                    while (nextMoves.length < 4) nextMoves.push('');
                    nextMoves[idx] = next;
                    onChange({ ...set, moves: nextMoves });
                  }}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Right: EV/IV/Nature + IO */}
        <div style={{ display: 'grid', gap: 12 }}>
          <div>
            <div style={styles.sectionTitle}>Nature / EVs / IVs</div>
            <IconCombobox
              label="nature"
              value={String(set.nature ?? '')}
              onChange={(next) => onChange({ ...set, nature: next as any })}
              items={[{ id: '', name: '(none)' }, ...natureList]}
              allowEmpty
            />
            <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
              <div style={styles.sub}>
                EV remaining: <span style={{ fontWeight: 900, color: evRemaining < 0 ? 'crimson' : undefined }}>{evRemaining}</span>
              </div>
              {evError ? <div style={{ color: 'crimson', fontSize: 12 }}>{evError}</div> : null}
            </div>
            <div style={{ marginTop: 8, display: 'grid', gridTemplateColumns: '90px 1fr 1fr', gap: 8, alignItems: 'center' }}>
              <div style={{ fontSize: 12, color: '#666' }} />
              <div style={{ fontSize: 12, color: '#666' }}>EV</div>
              <div style={{ fontSize: 12, color: '#666' }}>IV</div>
              {statKeys.map((k) => {
                const plus = natureEff?.plus === k;
                const minus = natureEff?.minus === k;
                const label = BattleStatNames[k];
                return (
                  <React.Fragment key={k}>
                    <div style={{ fontWeight: 700 }}>
                      {label}
                      {plus ? <span style={{ marginLeft: 6, color: '#0a7' }}>+</span> : null}
                      {minus ? <span style={{ marginLeft: 6, color: 'crimson' }}>-</span> : null}
                    </div>
                    <input
                      type="number"
                      min={0}
                      max={252}
                      style={styles.input}
                      value={Number(set.evs?.[k] ?? 0)}
                      onChange={(e) => {
                        const v = clampInt(e.target.value, 0, 252);
                        onChange({ ...set, evs: { ...(set.evs ?? {}), [k]: v } });
                      }}
                    />
                    <input
                      type="number"
                      min={0}
                      max={31}
                      style={styles.input}
                      value={Number(set.ivs?.[k] ?? 31)}
                      onChange={(e) => {
                        const v = clampInt(e.target.value, 0, 31);
                        onChange({ ...set, ivs: { ...(set.ivs ?? {}), [k]: v } });
                      }}
                    />
                  </React.Fragment>
                );
              })}
            </div>
          </div>

          <div>
            <div style={styles.sectionTitle}>Import / Export</div>
            <div style={styles.sub}>貼り付けて Import → フォーム反映 / Export → テキスト生成</div>
            <textarea
              rows={10}
              style={{
                ...styles.input,
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
                lineHeight: 1.35,
              }}
              value={ioText}
              onChange={(e) => {
                setIoText(e.target.value);
                setIoErr('');
              }}
              placeholder={'Incineroar @ Sitrus Berry\nAbility: Intimidate\nLevel: 50\nEVs: 252 HP / 4 Atk / 252 SpD\nCareful Nature\n- Fake Out\n- Flare Blitz\n- Parting Shot\n- Snarl'}
            />
            {ioErr ? <div style={{ marginTop: 8, color: 'crimson' }}>{ioErr}</div> : null}
            <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                type="button"
                style={styles.btn}
                onClick={() => {
                  try {
                    const parsed = importTeam(ioText);
                    if (!parsed.length) {
                      setIoErr('Parse failed: no valid set found');
                      return;
                    }
                    const next = parsed[0];
                    if (!String(next.species ?? '').trim()) {
                      setIoErr('Parse failed: Species is empty');
                      return;
                    }
                    // ensure 4 moves
                    onChange({ ...blankSet(next.species), ...next, moves: next.moves });
                    setIoErr('');
                  } catch (e: any) {
                    setIoErr(String(e?.message ?? e));
                  }
                }}
              >
                Import
              </button>
              <button
                type="button"
                style={styles.btn}
                onClick={() => {
                  const t = exportSet(set);
                  setIoText(t);
                  setIoErr('');
                }}
              >
                Export
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

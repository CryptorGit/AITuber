import React, { useEffect, useRef } from 'react';

export type PokemonSet = {
  name?: string;
  species?: string;
  item?: string;
  ability?: string;
  nature?: string;
  teraType?: string;
  level?: number;
  shiny?: boolean;
  gender?: 'M' | 'F' | '';
  happiness?: number;
  moves?: string[];
  evs?: Partial<Record<'hp' | 'atk' | 'def' | 'spa' | 'spd' | 'spe', number>>;
  ivs?: Partial<Record<'hp' | 'atk' | 'def' | 'spa' | 'spd' | 'spe', number>>;
};

export type SpeciesDetail = {
  name: string;
  id: string;
  icon_url?: string;
  baseStats?: Partial<Record<'hp' | 'atk' | 'def' | 'spa' | 'spd' | 'spe', number>>;
  types?: string[];
  abilities?: { name: string }[];
};

type StatKey = 'hp' | 'atk' | 'def' | 'spa' | 'spd' | 'spe';
type IconSheet = { kind: 'sheet'; url: string; size: number; x: number; y: number };

const STAT_ORDER: StatKey[] = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];
const STAT_LABEL: Record<StatKey, string> = {
  hp: 'HP',
  atk: 'Atk',
  def: 'Def',
  spa: 'SpA',
  spd: 'SpD',
  spe: 'Spe',
};

const NATURE_EFFECTS: Record<string, { plus: StatKey; minus: StatKey } | null> = {
  Hardy: null,
  Lonely: { plus: 'atk', minus: 'def' },
  Brave: { plus: 'atk', minus: 'spe' },
  Adamant: { plus: 'atk', minus: 'spa' },
  Naughty: { plus: 'atk', minus: 'spd' },
  Bold: { plus: 'def', minus: 'atk' },
  Docile: null,
  Relaxed: { plus: 'def', minus: 'spe' },
  Impish: { plus: 'def', minus: 'spa' },
  Lax: { plus: 'def', minus: 'spd' },
  Timid: { plus: 'spe', minus: 'atk' },
  Hasty: { plus: 'spe', minus: 'def' },
  Serious: null,
  Jolly: { plus: 'spe', minus: 'spa' },
  Naive: { plus: 'spe', minus: 'spd' },
  Modest: { plus: 'spa', minus: 'atk' },
  Mild: { plus: 'spa', minus: 'def' },
  Quiet: { plus: 'spa', minus: 'spe' },
  Bashful: null,
  Rash: { plus: 'spa', minus: 'spd' },
  Calm: { plus: 'spd', minus: 'atk' },
  Gentle: { plus: 'spd', minus: 'def' },
  Sassy: { plus: 'spd', minus: 'spe' },
  Careful: { plus: 'spd', minus: 'spa' },
  Quirky: null,
};

function clampInt(n: unknown, lo: number, hi: number, fallback: number): number {
  const x = typeof n === 'number' && Number.isFinite(n) ? Math.trunc(n) : fallback;
  return Math.max(lo, Math.min(hi, x));
}

function getNatureMult(nature: string | undefined, stat: StatKey): number {
  // Minimal nature mapping (Showdown-like): only supports the 25 canonical nature names.
  const n = (nature ?? '').trim();
  if (!n) return 1;
  const entry = NATURE_EFFECTS[n] ?? null;
  if (!entry) return 1;
  if (stat === entry.plus) return 1.1;
  if (stat === entry.minus) return 0.9;
  return 1;
}

function calcStat(args: {
  base: number;
  iv: number;
  ev: number;
  level: number;
  nature: number;
  isHp: boolean;
}): number {
  const { base, iv, ev, level, nature, isHp } = args;
  const evPart = Math.floor(ev / 4);
  const inner = Math.floor(((2 * base + iv + evPart) * level) / 100);
  if (isHp) return inner + level + 10;
  return Math.floor((inner + 5) * nature);
}

function withMoveCount(moves: string[] | undefined): string[] {
  const m = (moves ?? []).slice(0, 4);
  while (m.length < 4) m.push('');
  return m;
}

export function PsSetChart(props: {
  set: PokemonSet;
  speciesDetail: SpeciesDetail | null;
  itemIcon?: IconSheet | null;
  onChange: (next: PokemonSet) => void;
  onDelete: () => void;
  onOpenImportExport: () => void;
  onFocusField: (mode: 'pokemon' | 'item' | 'ability' | 'move' | 'nature' | 'teraType', query: string, moveIndex?: number) => void;
  showMenu?: boolean;
  onOpenStats?: () => void;
  onOpenDetails?: () => void;
  onApply?: () => void;
  onReset?: () => void;
  canApply?: boolean;
  canReset?: boolean;
  focusField?: { mode: 'pokemon' | 'item' | 'ability' | 'move' | 'nature' | 'teraType'; moveIndex?: number; seq: number } | null;
}): React.ReactElement {
  const { set, speciesDetail, itemIcon, onChange, onDelete, onOpenImportExport, onFocusField, onOpenStats, onOpenDetails, onApply, onReset, canApply, canReset, focusField } = props;
  const showMenu = props.showMenu ?? true;

  const nicknameRef = useRef<HTMLInputElement | null>(null);
  const pokemonRef = useRef<HTMLInputElement | null>(null);
  const itemRef = useRef<HTMLInputElement | null>(null);
  const abilityRef = useRef<HTMLInputElement | null>(null);
  const moveRefs = useRef<Array<HTMLInputElement | null>>([]);

  useEffect(() => {
    if (!focusField) return;
    let target: HTMLInputElement | null = null;
    if (focusField.mode === 'pokemon') target = pokemonRef.current;
    if (focusField.mode === 'item') target = itemRef.current;
    if (focusField.mode === 'ability') target = abilityRef.current;
    if (focusField.mode === 'move') target = moveRefs.current[focusField.moveIndex ?? 0] ?? null;
    if (target) target.focus();
  }, [focusField?.seq]);

  const level = clampInt(set.level ?? 50, 1, 100, 50);
  const natureName = (set.nature ?? '').trim();
  const moves = withMoveCount(set.moves);

  const baseStats = speciesDetail?.baseStats ?? {};
  const evs = set.evs ?? {};
  const ivs = set.ivs ?? {};

  const natureEffect = NATURE_EFFECTS[natureName] ?? null;

  const derived: Partial<Record<StatKey, number>> = {};
  for (const stat of STAT_ORDER) {
    const base = clampInt((baseStats as any)[stat], 1, 255, 1);
    const ev = clampInt((evs as any)[stat], 0, 252, 0);
    const iv = clampInt((ivs as any)[stat], 0, 31, 31);
    derived[stat] = calcStat({
      base,
      ev,
      iv,
      level,
      nature: getNatureMult(natureName, stat),
      isHp: stat === 'hp',
    });
  }

  const types = speciesDetail?.types ?? [];
  const gender = String(set.gender ?? '').trim();
  const blankLabel = '\u2014';
  const genderLabel = gender === 'M' ? 'Male' : gender === 'F' ? 'Female' : blankLabel;
  const shinyLabel = set.shiny ? 'Yes' : 'No';
  const teraLabel = String(set.teraType ?? '').trim() || types[0] || blankLabel;
  const itemIconStyle = itemIcon?.url
    ? {
        backgroundImage: `url(${itemIcon.url})`,
        backgroundRepeat: 'no-repeat',
        backgroundPosition: `-${itemIcon.x}px -${itemIcon.y}px`,
      }
    : undefined;
  const spriteUrl = (() => {
    const base = speciesDetail?.icon_url;
    if (!base) return '/sprites/gen5/0.png';
    if (!set.shiny) return base;
    return base.includes('/sprites/gen5/')
      ? base.replace('/sprites/gen5/', '/sprites/gen5-shiny/')
      : base;
  })();
  const setchartStyle = {
    backgroundImage: `url(${spriteUrl})`,
    backgroundRepeat: 'no-repeat',
    backgroundPosition: '10px 5px',
  };

  const renderTypeIcon = (type: string) => (
    <img
      key={type}
      src={`/sprites/types/${encodeURIComponent(type)}.png`}
      alt={type}
      width={32}
      height={14}
      className="pixelated"
    />
  );

  return (
    <li>
      {showMenu ? (
        <div className="setmenu">
          <button type="button" onClick={onOpenImportExport}>
            Import / Export
          </button>
          {onApply ? (
            <>
              {' '}
              <button type="button" onClick={onApply} disabled={!canApply}>
                Apply
              </button>
            </>
          ) : null}
          {onReset ? (
            <>
              {' '}
              <button type="button" onClick={onReset} disabled={!canReset}>
                Reset
              </button>
            </>
          ) : null}
          {' '}
          <button
            type="button"
            onClick={onDelete}
          >
            Delete
          </button>
        </div>
      ) : null}

      <div className="setchart-nickname">
        <label>Nickname</label>
        <input
          className="textbox"
          ref={nicknameRef}
          value={set.name ?? ''}
          onChange={(e) => onChange({ ...set, name: e.target.value })}
        />
      </div>

      <div className="setchart" style={setchartStyle}>
        <div className="setcol setcol-icon">
          <div className="setcell-sprite" />

          <div className="setcell setcell-pokemon">
            <label>Pokémon</label>
            <input
              className="textbox chartinput"
              ref={pokemonRef}
              value={set.species ?? ''}
              onChange={(e) => {
                const v = e.target.value;
                onChange({ ...set, species: v });
                onFocusField('pokemon', v);
              }}
              onFocus={() => onFocusField('pokemon', set.species ?? '')}
            />
          </div>
        </div>

        <div className="setcol setcol-details">
          <div className="setrow">
            <div className="setcell setcell-details">
              <label>Details</label>
              <button
                type="button"
                name="details"
                className="textbox setdetails"
                tabIndex={-1}
                onClick={() => onOpenDetails?.()}
              >
                <span className="detailcell detailcell-first">
                  <label>Level</label>
                  {level}
                </span>
                <span className="detailcell">
                  <label>Gender</label>
                  {genderLabel}
                </span>
                <span className="detailcell">
                  <label>Shiny</label>
                  {shinyLabel}
                </span>
                <span className="detailcell">
                  <label>Tera Type</label>
                  {teraLabel}
                </span>
              </button>
            </div>
          </div>

          <div className="setrow setrow-icons">
            <div className="setcell">
              <span className="itemicon" style={itemIconStyle} />
            </div>
            <div className="setcell setcell-typeicons">
              {types.length ? (
                types.slice(0, 2).map(renderTypeIcon)
              ) : null}
            </div>
          </div>

          <div className="setrow">
            <div className="setcell setcell-item">
              <label>Item</label>
              <input
                className="textbox chartinput"
                ref={itemRef}
                value={set.item ?? ''}
                onChange={(e) => {
                  const v = e.target.value;
                  onChange({ ...set, item: v });
                  onFocusField('item', v);
                }}
                onFocus={() => onFocusField('item', set.item ?? '')}
              />
            </div>

            <div className="setcell setcell-ability">
              <label>Ability</label>
              <input
                className="textbox chartinput"
                ref={abilityRef}
                value={set.ability ?? ''}
                onChange={(e) => {
                  const v = e.target.value;
                  onChange({ ...set, ability: v });
                  onFocusField('ability', v);
                }}
                onFocus={() => onFocusField('ability', set.ability ?? '')}
              />
            </div>
          </div>
        </div>

        <div className="setcol setcol-moves">
          {moves.map((mv, i) => (
            <div className="setcell" key={i}>
              <label>{i === 0 ? 'Moves' : ''}</label>
              <input
                className="textbox chartinput"
                ref={(el) => {
                  moveRefs.current[i] = el;
                }}
                value={mv}
                onChange={(e) => {
                  const v = e.target.value;
                  const nextMoves = moves.slice();
                  nextMoves[i] = v;
                  onChange({ ...set, moves: nextMoves });
                  onFocusField('move', v, i);
                }}
                onFocus={() => onFocusField('move', moves[i] ?? '', i)}
              />
            </div>
          ))}
        </div>

        <div className="setcol setcol-stats">
          <div className="setrow">
            <label>Stats</label>
            <button
              type="button"
              name="stats"
              className="textbox setstats"
              onClick={() => onOpenStats?.()}
              style={{ cursor: onOpenStats ? 'pointer' : 'default' }}
            >
              <span className="statrow statrow-head">
                <label></label>
                <span className="statgraph"></span>
                <em>EV</em>
              </span>
              {STAT_ORDER.map((stat) => {
                const ev = clampInt((evs as any)[stat], 0, 252, 0);
                const val = derived[stat] ?? 0;
                let width = Math.floor((val * 75) / 504);
                if (stat === 'hp') width = Math.floor((val * 75) / 704);
                if (width > 75) width = 75;
                let hue = Math.floor((val * 180) / 714);
                if (hue > 360) hue = 360;
                const plus = natureEffect?.plus === stat;
                const minus = natureEffect?.minus === stat;
                const evText = ev ? String(ev) : '';
                return (
                  <span className="statrow" key={stat}>
                    <label>{STAT_LABEL[stat]}</label>
                    <span className="statgraph">
                      <span style={{ width: `${width}px`, background: `hsl(${hue},40%,75%)` }} />
                    </span>
                    <em>{evText}</em>
                    {plus ? <small>+</small> : null}
                    {minus ? <small>-</small> : null}
                  </span>
                );
              })}
            </button>
          </div>
        </div>
      </div>
    </li>
  );
}
